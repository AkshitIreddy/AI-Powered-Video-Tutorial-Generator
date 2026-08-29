from __future__ import annotations

import base64
import json
import os
import queue
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TextIO

import pytest

from alystria.desktop_worker import PROTOCOL_VERSION, connect_address
from alystria.generation import GenerationCoordinator, GenerationRequest
from alystria.project import ProjectStore

TOKEN = "desktop-test-token-0123456789abcdef"


class WorkerProcess:
    def __init__(self, process: subprocess.Popen[str], endpoint: str) -> None:
        self.process = process
        self.endpoint = endpoint

    def call(
        self,
        method: str,
        payload: dict[str, Any] | None,
        *,
        token: str = TOKEN,
        protocol_version: int = PROTOCOL_VERSION,
    ) -> dict[str, Any]:
        request_id = str(uuid.uuid4())
        request = {
            "protocolVersion": protocol_version,
            "id": request_id,
            "authenticationToken": token,
            "method": method,
            "payload": payload,
        }
        with socket.create_connection(connect_address(self.endpoint), timeout=5) as connection:
            connection.settimeout(10)
            connection.sendall(
                (json.dumps(request, separators=(",", ":")) + "\n").encode("utf-8")
            )
            connection.shutdown(socket.SHUT_WR)
            chunks: list[bytes] = []
            while True:
                chunk = connection.recv(64 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
        response = json.loads(b"".join(chunks))
        assert response["protocolVersion"] == PROTOCOL_VERSION
        assert response["id"] == request_id
        return response

    def shutdown(self) -> None:
        if self.process.poll() is None:
            response = self.call("system.shutdown", None)
            assert response["ok"] is True
        self.process.wait(timeout=10)
        assert self.process.returncode == 0


def _readline_with_timeout(stream: TextIO, timeout: float) -> str:
    result: queue.Queue[str] = queue.Queue(maxsize=1)

    def read() -> None:
        result.put(stream.readline())

    threading.Thread(target=read, daemon=True).start()
    try:
        return result.get(timeout=timeout)
    except queue.Empty as error:
        raise TimeoutError("Worker did not emit readiness before the test deadline") from error


@contextmanager
def running_worker() -> Iterator[WorkerProcess]:
    environment = os.environ.copy()
    source_root = Path(__file__).parents[2] / "src"
    existing_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        str(source_root) if not existing_path else os.pathsep.join((str(source_root), existing_path))
    )
    environment["ALYSTRIA_WORKER_AUTH"] = "stdin"
    environment["ALYSTRIA_WORKER_PROTOCOL"] = str(PROTOCOL_VERSION)
    process = subprocess.Popen(
        [sys.executable, "-m", "alystria.cli", "--alystria-desktop-worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(
        json.dumps(
            {"protocolVersion": PROTOCOL_VERSION, "authenticationToken": TOKEN},
            separators=(",", ":"),
        )
        + "\n"
    )
    process.stdin.flush()
    process.stdin.close()
    worker: WorkerProcess | None = None
    try:
        ready_line = _readline_with_timeout(process.stdout, 10)
        if not ready_line:
            stderr = "" if process.stderr is None else process.stderr.read()
            pytest.fail(f"Desktop worker exited before readiness: {stderr}")
        ready = json.loads(ready_line)
        assert ready["type"] == "ready"
        assert ready["protocolVersion"] == PROTOCOL_VERSION
        host, port = connect_address(ready["endpoint"])
        assert port > 0
        assert socket.getaddrinfo(host, port)[0][4][0] in {"::1", "127.0.0.1"}
        worker = WorkerProcess(process, ready["endpoint"])
        yield worker
    finally:
        if process.poll() is None:
            try:
                if worker is not None:
                    worker.shutdown()
                else:
                    process.kill()
                    process.wait(timeout=5)
            except (AssertionError, ConnectionError, OSError, TimeoutError):
                process.kill()
                process.wait(timeout=5)


def _create_rust_project_skeleton(root: Path, project_id: str) -> None:
    root.mkdir()
    for relative in (
        "objects/sha256",
        "sources/original",
        "sources/quarantine",
        "staging",
        "exports",
        "backups",
    ):
        (root / relative).mkdir(parents=True)
    manifest = {
        "schemaVersion": 1,
        "projectId": project_id,
        "title": "Karatsuba multiplication",
        "locale": "en-US",
        "groundingMode": "strict",
        "createdAt": "2026-08-28T10:00:00Z",
        "updatedAt": "2026-08-28T10:00:00Z",
        "manifestRevision": 1,
        "activeSnapshotId": None,
        "databaseRelativePath": "project.sqlite3",
        "objectStoreRelativePath": "objects/sha256",
        "sourceStoreRelativePath": "sources/original",
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def _local_routing_policy() -> dict[str, Any]:
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
                "model": "mock-tts-v1",
                "voice": "mock-voice-en",
            },
        ],
    }


def test_real_worker_handshake_authentication_ping_and_shutdown() -> None:
    with running_worker() as worker:
        rejected = worker.call("system.ping", None, token="incorrect-token-0123456789abcdef")
        assert rejected["ok"] is False
        assert rejected["error"]["code"] == "UNAUTHENTICATED"

        ping = worker.call("system.ping", None)
        assert ping["ok"] is True
        assert ping["result"]["service"] == "alystria-pipeline"
        assert ping["result"]["status"] == "ok"

        worker.shutdown()


def test_real_worker_persists_provider_routing_policy_from_desktop_shape(
    tmp_path: Path,
) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Provider Routing Project"
    _create_rust_project_skeleton(project, project_id)

    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
                "initialSnapshot": {
                    "id": project_id,
                    "title": "Provider routing",
                    "sources": [],
                },
            },
        )
        assert initialized["ok"] is True

        policy = _local_routing_policy()
        saved = worker.call(
            "provider.routingPolicy.save",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": initialized["result"]["headRevisionId"],
                "policy": policy,
                "message": "Approve local media routes",
            },
        )
        assert saved["ok"] is True, saved
        saved_policy = saved["result"]["policy"]
        assert saved_policy["privacyMode"] == "local"
        assert saved_policy["routes"] == policy["routes"]
        assert saved_policy["approvals"][0]["providerId"] == "mock"

        loaded = worker.call(
            "provider.routingPolicy.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )
        assert loaded["ok"] is True, loaded
        assert loaded["result"]["policy"] == saved_policy
        assert loaded["result"]["headRevisionId"] == saved["result"]["headRevisionId"]


def test_real_worker_initializes_project_and_persists_generation_lifecycle(
    tmp_path: Path,
) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Rust Project"
    _create_rust_project_skeleton(project, project_id)

    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
                "initialSnapshot": {
                    "id": "provisional-ui-id",
                    "title": "Karatsuba multiplication",
                    "topic": "Explain the three-product identity",
                    "audience": "Undergraduate students",
                    "duration": 12,
                    "locale": "en-US",
                    "groundingMode": "strict",
                    "brief": {
                        "topic": "Explain the three-product identity",
                        "audience": "Undergraduate students",
                        "durationSeconds": 720,
                        "locale": "en-US",
                    },
                    "scenes": [],
                    "sources": [],
                },
            },
        )
        assert initialized["ok"] is True
        assert initialized["result"]["databaseReady"] is True

        # Initialization is deliberately idempotent and does not add another
        # initial revision when the desktop retries after a lost response.
        assert worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
            },
        )["ok"] is True

        database = sqlite3.connect(project / "project.sqlite3")
        try:
            assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            row = database.execute(
                "SELECT project_id,name FROM project_meta WHERE singleton=1"
            ).fetchone()
            assert row == (project_id, "Karatsuba multiplication")
            assert database.execute("SELECT COUNT(*) FROM revisions").fetchone()[0] == 1
            snapshot = json.loads(
                database.execute(
                    "SELECT snapshot_json FROM revisions WHERE revision_number=1"
                ).fetchone()[0]
            )
            assert snapshot["id"] == project_id
            assert snapshot["audience"] == "Undergraduate students"
        finally:
            database.close()

        rpc_started_at = time.monotonic()
        started = worker.call(
            "generation.start",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
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
            },
        )
        assert time.monotonic() - rpc_started_at < 1.0
        assert started["ok"] is True
        receipt = started["result"]
        job_id = str(uuid.UUID(receipt["jobId"]))
        assert receipt["state"] in {"QUEUED", "RUNNING"}, receipt
        assert receipt["events"]

        action = {
            "projectId": project_id,
            "projectDirectory": str(project),
            "jobId": job_id,
        }
        deadline = time.monotonic() + 15
        while True:
            status = worker.call("job.status", action)
            assert status["ok"] is True
            if status["result"]["state"] == "BLOCKED":
                break
            assert status["result"]["state"] in {"QUEUED", "RUNNING"}
            if time.monotonic() >= deadline:
                pytest.fail(f"background planning did not reach approval: {status}")
            time.sleep(0.05)

        cancelled = worker.call("generation.cancel", action)
        assert cancelled["ok"] is True
        assert cancelled["result"]["state"] == "CANCELLED"
        assert cancelled["result"]["retryable"] is True

        retried = worker.call("generation.retry", action)
        assert retried["ok"] is True
        assert retried["result"]["state"] in {"QUEUED", "BLOCKED"}


def test_acceptance_desktop_worker_creates_approves_generates_and_exports(
    tmp_path: Path,
) -> None:
    """Exercise the same durable lifecycle exposed by the desktop command broker.

    This deliberately uses the explicit fixture renderer and local deterministic
    media adapters inherited from ``conftest.py``.  It proves the app/sidecar
    contract without pretending that provider credentials, model weights, GPU
    inference, Chromium, or FFmpeg were exercised.
    """

    project_id = str(uuid.uuid4())
    project = tmp_path / "Acceptance Tutorial"
    _create_rust_project_skeleton(project, project_id)

    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
                "initialSnapshot": {
                    "id": "desktop-provisional-id",
                    "title": "Karatsuba acceptance tutorial",
                    "topic": "Explain why Karatsuba needs only three recursive products",
                    "audience": "Undergraduate computer science students",
                    "duration": 2,
                    "locale": "en-US",
                    "groundingMode": "grounded",
                    "brief": {
                        "topic": "Explain why Karatsuba needs only three recursive products",
                        "audience": "Undergraduate computer science students",
                        "durationSeconds": 120,
                        "locale": "en-US",
                    },
                    "scenes": [],
                    "sources": [],
                },
            },
        )
        assert initialized["ok"] is True
        initial_head = initialized["result"]["headRevisionId"]

        started = worker.call(
            "generation.start",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "snapshotId": initial_head,
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
            },
        )
        assert started["ok"] is True
        generation_id = str(uuid.UUID(started["result"]["jobId"]))
        action = {
            "projectId": project_id,
            "projectDirectory": str(project),
            "jobId": generation_id,
        }

        waiting = _poll_worker_job(
            worker,
            action,
            terminal_states={"BLOCKED", "FAILED", "CANCELLED"},
            timeout=20,
        )
        assert waiting["state"] == "BLOCKED", waiting
        assert waiting["events"]
        assert waiting["stages"][-1]["state"] == "SUCCEEDED"

        approved = worker.call(
            "generation.approve",
            {
                **action,
                "name": "Acceptance storyboard",
                "message": "Approved by the automated desktop acceptance harness",
            },
        )
        assert approved["ok"] is True
        assert approved["result"]["state"] in {"QUEUED", "RUNNING", "SUCCEEDED"}
        assert approved["result"]["approvalRevisionId"]

        completed = _poll_worker_job(
            worker,
            action,
            terminal_states={"SUCCEEDED", "FAILED", "CANCELLED"},
            timeout=30,
        )
        assert completed["state"] == "SUCCEEDED", completed
        assert completed["progress"] == pytest.approx(1)
        assert completed["finalRevisionId"]
        assert all(stage["state"] == "SUCCEEDED" for stage in completed["stages"])

        durable = worker.call(
            "project.snapshot.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )
        assert durable["ok"] is True
        head = durable["result"]["headRevisionId"]
        snapshot = durable["result"]["snapshot"]
        assert snapshot["generationId"] == generation_id
        assert snapshot["stage"] == "export"
        assert snapshot["stageArtifactHash"]
        assert snapshot["payload"]["exportManifest"]["qualityGate"]["status"] in {
            "PASS",
            "WARNING",
        }

        export_submitted = worker.call(
            "control.exportMaster",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "baseRevisionId": head,
                "baseJobId": generation_id,
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
                "captions": True,
                "transcript": True,
                "bibliography": True,
            },
        )
        assert export_submitted["ok"] is True
        export_action = {
            "projectId": project_id,
            "projectDirectory": str(project),
            "jobId": str(uuid.UUID(export_submitted["result"]["jobId"])),
        }
        exported = _poll_worker_job(
            worker,
            export_action,
            terminal_states={"SUCCEEDED", "FAILED", "CANCELLED"},
            timeout=20,
        )
        assert exported["state"] == "SUCCEEDED", exported
        export_result = exported["result"]
        master = Path(export_result["path"])
        assert master.is_file()
        assert master.stat().st_size > 0
        assert export_result["operation"] == "export_master"
        assert export_result["qualityGate"]["status"] in {"PASS", "WARNING"}
        assert all(Path(path).is_file() for path in export_result["sidecarPaths"])

        archive = project / "exports" / "acceptance.alytutorial"
        archived = worker.call(
            "project.export",
            {
                "projectPath": str(project),
                "destination": str(archive),
                "overwrite": False,
            },
        )
        assert archived["ok"] is True
        assert archive.is_file()
        assert archive.stat().st_size > master.stat().st_size


def _poll_worker_job(
    worker: WorkerProcess,
    action: dict[str, Any],
    *,
    terminal_states: set[str],
    timeout: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        response = worker.call("job.status", action)
        assert response["ok"] is True
        receipt = response["result"]
        if receipt["state"] in terminal_states:
            return receipt
        if time.monotonic() >= deadline:
            pytest.fail(
                f"job {action['jobId']} did not reach {sorted(terminal_states)}: {receipt}"
            )
        time.sleep(0.05)


def test_restarted_worker_recovers_an_expired_generation_lease(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Restarted Worker Project"
    _create_rust_project_skeleton(project, project_id)
    with running_worker() as first_worker:
        assert first_worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
            },
        )["ok"] is True

    with ProjectStore.open(project) as store:
        coordinator = GenerationCoordinator(store)
        generation_id = coordinator.start(
            GenerationRequest(topic="Lease recovery", audience="Test", duration_seconds=60)
        ).generation_id
        claim = coordinator.runtime._claim_next()
        assert claim is not None
        store.connection.execute(
            "UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00Z' WHERE job_id=?",
            (claim[0].job_id,),
        )

    action = {
        "projectId": project_id,
        "projectDirectory": str(project),
        "jobId": generation_id,
    }
    with running_worker() as restarted_worker:
        # Status registration teaches the fresh process which local project to
        # recover; no new generation request is required after restart.
        first_status = restarted_worker.call("job.status", action)
        assert first_status["ok"] is True
        deadline = time.monotonic() + 15
        while True:
            status = restarted_worker.call("job.status", action)
            assert status["ok"] is True
            if status["result"]["state"] == "BLOCKED":
                break
            if time.monotonic() >= deadline:
                pytest.fail(f"restarted worker did not recover generation: {status}")
            time.sleep(0.05)

    database = sqlite3.connect(project / "project.sqlite3")
    try:
        assert database.execute(
            "SELECT COUNT(*) FROM job_attempts WHERE state='ABANDONED'"
        ).fetchone()[0] == 1
    finally:
        database.close()


def test_worker_snapshot_source_import_and_archive_round_trip(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Durable Project"
    _create_rust_project_skeleton(project, project_id)
    initial_snapshot = {
        "id": "temporary",
        "title": "Durable tutorial",
        "topic": "A durable topic",
        "audience": "General",
        "duration": 5,
        "locale": "English",
        "scenes": [{"id": "scene-1", "narration": "Before"}],
        "sources": [],
    }

    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
                "initialSnapshot": initial_snapshot,
            },
        )
        head = initialized["result"]["headRevisionId"]

        loaded = worker.call(
            "project.snapshot.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )
        assert loaded["ok"] is True
        assert loaded["result"]["snapshot"]["id"] == project_id
        assert loaded["result"]["headRevisionId"] == head

        edited = dict(loaded["result"]["snapshot"])
        edited["scenes"] = [{"id": "scene-1", "narration": "After restart"}]
        saved = worker.call(
            "project.snapshot.save",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": head,
                "snapshot": edited,
                "message": "Edited narration",
            },
        )
        assert saved["ok"] is True
        assert saved["result"]["snapshot"]["scenes"][0]["narration"] == "After restart"

        conflict = worker.call(
            "project.snapshot.save",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": head,
                "snapshot": edited,
            },
        )
        assert conflict["ok"] is False
        assert conflict["error"]["code"] == "REVISION_CONFLICT"

        imported = worker.call(
            "source.import",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": saved["result"]["headRevisionId"],
                "filename": "notes.md",
                "mimeType": "text/markdown",
                "privacy": "project_local",
                "rightsStatus": "owned",
                "license": "User supplied",
                "attribution": None,
                "contentBase64": base64.b64encode(b"# Trusted notes\n").decode("ascii"),
            },
        )
        assert imported["ok"] is True
        source = imported["result"]
        assert source["byteSize"] == len(b"# Trusted notes\n")
        assert (project / source["storedRelativePath"]).read_bytes() == b"# Trusted notes\n"
        assert not list((project / "sources" / "quarantine").iterdir())

        final = worker.call(
            "project.snapshot.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )
        assert final["result"]["snapshot"]["sources"][0]["artifactHash"] == source["artifactHash"]

        destination = project / "exports" / "durable.alytutorial"
        archived = worker.call(
            "project.export",
            {
                "projectPath": str(project),
                "destination": str(destination),
                "overwrite": False,
            },
        )
        assert archived["ok"] is True
        assert destination.is_file()


def test_worker_rejects_source_over_eight_mib(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Bounded Project"
    _create_rust_project_skeleton(project, project_id)
    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
            },
        )
        too_large = base64.b64encode(b"a" * (8 * 1024 * 1024 + 1)).decode("ascii")
        response = worker.call(
            "source.import",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": initialized["result"]["headRevisionId"],
                "filename": "too-large.txt",
                "mimeType": "text/plain",
                "privacy": "project_local",
                "rightsStatus": "unknown",
                "contentBase64": too_large,
            },
        )
        assert response["ok"] is False
        assert response["error"]["code"] == "INVALID_ARGUMENT"
        assert not list((project / "sources" / "quarantine").iterdir())


def test_project_initialization_rejects_manifest_identity_mismatch(tmp_path: Path) -> None:
    manifest_id = str(uuid.uuid4())
    project = tmp_path / "Identity Project"
    _create_rust_project_skeleton(project, manifest_id)
    with running_worker() as worker:
        response = worker.call(
            "project.initialize",
            {
                "projectId": str(uuid.uuid4()),
                "projectDirectory": str(project),
                "manifestRevision": 1,
            },
        )
        assert response["ok"] is False
        assert response["error"]["code"] == "INVALID_PROJECT"
        assert not (project / "project.sqlite3").exists()


def test_worker_native_controls_queue_immediately_and_history_restores(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Native Controls"
    _create_rust_project_skeleton(project, project_id)
    with running_worker() as worker:
        initialized = worker.call(
            "project.initialize",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "manifestRevision": 1,
                "initialSnapshot": {
                    "id": "temporary",
                    "title": "Native controls",
                    "scenes": [
                        {
                            "id": "scene-one",
                            "title": "Accepted scene",
                            "kind": "definition",
                            "duration": 1,
                            "narration": "Accepted narration.",
                        }
                    ],
                    "sources": [],
                },
            },
        )["result"]
        first_head = initialized["headRevisionId"]
        loaded = worker.call(
            "project.snapshot.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )["result"]
        edited_snapshot = dict(loaded["snapshot"])
        edited_snapshot["title"] = "Edited title"
        saved = worker.call(
            "project.snapshot.save",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": first_head,
                "snapshot": edited_snapshot,
            },
        )["result"]
        history = worker.call(
            "project.history.get",
            {"projectId": project_id, "projectDirectory": str(project)},
        )["result"]
        assert history["canUndo"] is True
        undone = worker.call(
            "project.history.undo",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": saved["headRevisionId"],
            },
        )["result"]
        assert undone["snapshot"]["title"] == "Native controls"
        assert undone["history"]["canRedo"] is True
        redone = worker.call(
            "project.history.redo",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": undone["headRevisionId"],
            },
        )["result"]
        assert redone["snapshot"]["title"] == "Edited title"

        started_at = time.monotonic()
        render = worker.call(
            "control.renderScene",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "baseRevisionId": redone["headRevisionId"],
                "baseJobId": None,
                "sceneId": "scene-one",
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
            },
        )
        elapsed = time.monotonic() - started_at
        assert render["ok"] is True
        assert render["result"]["state"] == "QUEUED"
        assert elapsed < 2

        action = {
            "projectId": project_id,
            "projectDirectory": str(project),
            "jobId": render["result"]["jobId"],
        }
        deadline = time.monotonic() + 5
        while True:
            status = worker.call("job.status", action)["result"]
            if status["state"] in {"FAILED", "SUCCEEDED"}:
                break
            assert time.monotonic() < deadline
            time.sleep(0.05)
        if status["state"] == "FAILED":
            assert "Pinned renderer runtime is unavailable" in status["message"]
        else:
            assert Path(status["result"]["path"]).is_file()
            assert status["result"]["artifactHash"]


def test_concurrent_project_initialization_promotes_one_database(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project = tmp_path / "Concurrent Project"
    _create_rust_project_skeleton(project, project_id)
    payload = {
        "projectId": project_id,
        "projectDirectory": str(project),
        "manifestRevision": 1,
    }
    with running_worker() as worker, ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: worker.call("project.initialize", payload), range(2)))
        assert all(response["ok"] is True for response in responses)

    database = sqlite3.connect(project / "project.sqlite3")
    try:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert database.execute("SELECT COUNT(*) FROM project_meta").fetchone()[0] == 1
        assert database.execute("SELECT COUNT(*) FROM revisions").fetchone()[0] == 1
    finally:
        database.close()
