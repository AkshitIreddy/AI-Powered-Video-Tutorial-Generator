#!/usr/bin/env python3
"""Run Alystria's deterministic Karatsuba evaluation lane.

The command deliberately uses no provider credentials and blocks network access
while the pipeline is running.  Durable project state is created in a temporary
directory; compact evidence, a portable archive, and (optionally) a short real
renderer sample are written beneath ``dist/evaluation/v2`` by default.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import wave
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SRC = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))

from alystria.generation import (
    ALL_STAGES,
    DeterministicMediaClient,
    DeterministicRendererClient,
    GenerationCoordinator,
    GenerationStage,
    GenerationState,
    request_from_fixture,
)
from alystria.project import ProjectStore, export_project, import_project

FIXTURE = ROOT / "fixtures" / "canonical" / "karatsuba" / "fixture.json"
GOLDEN_DIRECTORY = ROOT / "fixtures" / "generated" / "karatsuba"
DEFAULT_OUTPUT = ROOT / "dist" / "evaluation" / "v2" / "karatsuba"
GENERATION_ID = "19620000-0000-4000-8000-000000000002"
PROJECT_ID = "prj_fixture_karatsuba_v2"
TICKS_PER_SECOND = 240_000


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> str:
    content = canonical_json(value).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return sha256_bytes(content)


@contextlib.contextmanager
def deny_pipeline_network() -> Iterator[None]:
    """Fail closed if deterministic pipeline code tries to open a socket."""

    original_create_connection = socket.create_connection

    def rejected(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("Canonical evaluation forbids pipeline network access")

    socket.create_connection = rejected
    try:
        yield
    finally:
        socket.create_connection = original_create_connection


def stage_payload(
    coordinator: GenerationCoordinator,
    generation_id: str,
    stage: GenerationStage,
) -> dict[str, Any]:
    jobs = [
        job
        for job in coordinator.runtime.list_jobs(
            project_id=coordinator.store.manifest.project_id,
            limit=1_000,
        )
        if job.parameters.get("generationId") == generation_id
        and job.parameters.get("stage") == stage.value
    ]
    if len(jobs) != 1 or jobs[0].result is None:
        raise AssertionError(f"Expected one completed {stage.value} job")
    payload = jobs[0].result.get("payload")
    if not isinstance(payload, dict):
        raise TypeError(f"Stage {stage.value} did not return an object payload")
    return payload


def normalize_export_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    """Remove run-local revision identity from the inspectable fixture summary."""

    normalized = dict(value)
    normalized["approvalRevisionId"] = "<run-local-approval-revision>"
    normalized["sources"] = [
        {**dict(source), "citation": normalize_fixture_locator(str(source["citation"]))}
        for source in value.get("sources", [])
    ]
    return normalized


def normalize_fixture_locator(value: str) -> str:
    normalized = value.replace("\\", "/")
    marker = "/fixtures/canonical/karatsuba/"
    if marker in normalized:
        suffix = normalized.split(marker, 1)[1]
        return f"fixture:karatsuba/{suffix}"
    return normalized


def normalize_evidence(value: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "sources": [
            {**dict(item), "locator": normalize_fixture_locator(str(item["locator"]))}
            for item in value["sources"]
        ],
        "evidenceChunks": [
            {**dict(item), "locator": normalize_fixture_locator(str(item["locator"]))}
            for item in value["evidenceChunks"]
        ],
        "claims": value["claims"],
        "policy": value["policy"],
    }


def compact_provenance(
    *,
    fixture: Mapping[str, Any],
    export_manifest: Mapping[str, Any],
    artifact_rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "fixture": {
            "id": fixture["id"],
            "sha256": sha256_file(FIXTURE),
            "sourceFiles": [
                {
                    "id": source["id"],
                    "path": source["path"],
                    "sha256": source["sha256"],
                    "licenseExpression": source["licenseExpression"],
                    "rightsStatus": source["rightsStatus"],
                }
                for source in fixture["sources"]
            ],
        },
        "generation": {
            "id": GENERATION_ID,
            "networkAccess": "denied",
            "provider": export_manifest["provenance"]["provider"],
            "modelRevision": export_manifest["provenance"]["modelRevision"],
            "renderer": export_manifest["provenance"]["renderer"],
            "rendererVersion": export_manifest["provenance"]["rendererVersion"],
            "seed": export_manifest["provenance"]["seed"],
            "providerCredentialsUsed": False,
        },
        "artifacts": sorted(
            (
                {
                    "sha256": str(row["hash"]),
                    "bytes": int(row["byte_size"]),
                    "mediaType": str(row["media_type"]),
                    "originalName": row["original_name"],
                }
                for row in artifact_rows
                if row["original_name"] not in {"export-manifest.json", "export.json"}
                and row["media_type"] != "application/vnd.alystria.generation-stage+json"
            ),
            key=lambda item: item["sha256"],
        ),
    }


def render_manifest(
    storyboard: Mapping[str, Any],
    narration: Mapping[str, Any],
    output_directory: Path,
) -> dict[str, Any]:
    scene = dict(storyboard["scenes"][0])
    narration_item = narration["narration"][0]
    duration_seconds = min(4, max(2, math.ceil(int(narration_item["durationMs"]) / 1_000)))
    duration_ticks = duration_seconds * TICKS_PER_SECOND
    narration_path = output_directory / "representative-narration.wav"
    return {
        "id": "evaluation-karatsuba-640x360",
        "schemaVersion": 1,
        "rendererVersion": "2.0.0-rc.0",
        "target": {
            "name": "custom",
            "width": 640,
            "height": 360,
            "pixelRatio": 1,
            "frameRate": {"numerator": 15, "denominator": 1},
            "colorSpace": "srgb-rec709",
            "safeArea": {"top": 20, "right": 28, "bottom": 28, "left": 28},
        },
        "scenes": [
            {
                "id": scene["id"],
                "kind": str(scene["type"]).replace("_", "-"),
                "durationTicks": duration_ticks,
                "seed": f"karatsuba-{scene['id']}-1962",
                "content": {
                    "eyebrow": "Algorithms / Divide and conquer",
                    "title": "Can four products become three?",
                    "body": "Karatsuba recovers the cross term with one combined product.",
                    "accent": "#5658E8",
                    "items": ["Split", "Three products", "Recombine"],
                },
                "captions": [
                    {
                        "id": "karatsuba-representative-caption",
                        "startTick": TICKS_PER_SECOND // 5,
                        "endTick": duration_ticks - TICKS_PER_SECOND // 5,
                        "text": "What if one recursive multiplication could disappear?",
                        "position": "bottom",
                    }
                ],
                "accessibilityDescription": scene["accessibilityDescription"],
                "metadata": {"fixture": "karatsuba", "networkRequired": False},
            }
        ],
        "audioInputs": [
            {
                "id": "audio.karatsuba.representative",
                "assetId": "artifact.karatsuba.representative-narration",
                "path": narration_path.as_posix(),
                "sha256": sha256_file(narration_path),
                "mediaType": "audio/wav",
                "role": "narration",
                "startTick": 0,
                "endTick": duration_ticks,
                "gainDb": 0,
            }
        ],
        "outputDirectory": (output_directory / "render").as_posix(),
        "metadata": {
            "fixture": "fixture.karatsuba.undergraduate.en",
            "generationId": GENERATION_ID,
            "provider": "local-deterministic",
        },
    }


def command_path(explicit: Path | None, candidates: Sequence[Path | str], label: str) -> Path:
    if explicit is not None:
        path = explicit.expanduser().resolve(strict=True)
        if not path.is_file():
            raise FileNotFoundError(f"{label} is not a file: {path}")
        return path
    for candidate in candidates:
        if isinstance(candidate, str):
            found = shutil.which(candidate)
            if found:
                return Path(found).resolve()
        elif candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError(f"Could not locate {label}; pass its explicit option")


def discover_chromium(expected_sha256: str, explicit: Path | None) -> Path:
    if explicit is not None:
        return command_path(explicit, (), "Chromium")
    candidates: list[Path] = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.extend(
            Path(local_app_data).glob("ms-playwright/chromium-*/chrome-win64/chrome.exe")
        )
    for path in candidates:
        if path.is_file() and sha256_file(path) == expected_sha256:
            return path.resolve()
    raise FileNotFoundError(
        "Could not locate Chromium matching dist/evaluation/runtime-manifest.dev.json"
    )


def wav_metrics(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as stream:
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        sample_rate = stream.getframerate()
        frame_count = stream.getnframes()
        content = stream.readframes(frame_count)
    if sample_width not in {2, 3, 4}:
        raise AssertionError(f"Expected 16-, 24-, or 32-bit PCM audio, got {sample_width * 8}-bit")
    samples = [
        int.from_bytes(content[offset : offset + sample_width], "little", signed=True)
        for offset in range(0, len(content), sample_width)
    ]
    peak_sample = max((abs(sample) for sample in samples), default=0)
    sum_squares = sum(sample * sample for sample in samples)
    rms_sample = math.sqrt(sum_squares / max(1, len(samples)))
    full_scale = 1 << (sample_width * 8 - 1)
    maximum_sample = full_scale - 1
    return {
        "path": path.name,
        "sha256": sha256_file(path),
        "sampleRateHz": sample_rate,
        "channels": channels,
        "sampleWidthBits": sample_width * 8,
        "durationSeconds": frame_count / sample_rate,
        "peak": peak_sample / full_scale,
        "rms": rms_sample / full_scale,
        "clippedSamples": sum(1 for sample in samples if abs(sample) >= maximum_sample),
        "silent": peak_sample == 0,
    }


def run_renderer(
    *,
    output_directory: Path,
    manifest_path: Path,
    runtime_path: Path,
    node: Path | None,
    chromium: Path | None,
    ffmpeg: Path | None,
    ffprobe: Path | None,
) -> dict[str, Any]:
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    browser_pin = runtime["renderer"]["chromium"]
    node_path = command_path(
        node,
        (
            "node",
            Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs" / "node.exe",
        ),
        "Node.js",
    )
    chromium_path = discover_chromium(str(browser_pin["executableSha256"]), chromium)
    ffmpeg_path = command_path(
        ffmpeg,
        ("ffmpeg", Path("C:/FFmpeg/bin/ffmpeg.exe")),
        "FFmpeg",
    )
    ffprobe_path = command_path(
        ffprobe,
        ("ffprobe", ffmpeg_path.with_name("ffprobe.exe")),
        "ffprobe",
    )
    renderer_cli = (ROOT / "services" / "renderer" / "dist" / "src" / "cli.js").resolve(
        strict=True
    )
    render_directory = output_directory / "render"
    command = [
        str(node_path),
        str(renderer_cli),
        "render",
        str(manifest_path),
        "--output-dir",
        str(render_directory),
        "--output",
        "karatsuba-representative.webm",
        "--browser",
        str(chromium_path),
        "--browser-version",
        str(browser_pin["browserVersion"]),
        "--browser-sha256",
        str(browser_pin["executableSha256"]),
        "--ffmpeg",
        str(ffmpeg_path),
        "--ffprobe",
        str(ffprobe_path),
        "--codec",
        "vp9",
        "--quality",
        "38",
        "--concurrency",
        "1",
        "--chunk-frames",
        "30",
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Renderer failed with exit code "
            f"{completed.returncode}: {completed.stderr[-4000:]}"
        )
    output = json.loads(completed.stdout)
    audio_path = render_directory / "audio-master.wav"
    if not audio_path.is_file():
        raise AssertionError("Renderer did not produce audio-master.wav")
    metrics = wav_metrics(audio_path)
    metrics_path = output_directory / "media-measurements.json"
    write_json(
        metrics_path,
        {
            "schemaVersion": 1,
            "audio": metrics,
            "video": output["probe"],
            "frameCount": output["frameCount"],
            "renderKey": output["renderKey"],
            "files": output["files"],
            "runtime": {
                "chromiumVersion": browser_pin["browserVersion"],
                "chromiumSha256": browser_pin["executableSha256"],
                "ffmpegVersion": runtime["media"]["ffmpeg"]["version"],
            },
        },
    )
    return {"output": output, "measurements": metrics, "metricsPath": metrics_path}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--runtime-manifest",
        type=Path,
        default=ROOT / "dist" / "evaluation" / "runtime-manifest.dev.json",
    )
    parser.add_argument("--skip-render", action="store_true")
    parser.add_argument("--node", type=Path)
    parser.add_argument("--chromium", type=Path)
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--ffprobe", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    output_directory = args.output_dir.expanduser().resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    with tempfile.TemporaryDirectory(prefix="alystria-karatsuba-evaluation-") as temporary:
        temporary_root = Path(temporary)
        project_root = temporary_root / "Karatsuba Tutorial"
        store = ProjectStore.create(
            project_root,
            name=str(fixture["title"]),
            project_id=PROJECT_ID,
            initial_snapshot={
                "fixtureId": fixture["id"],
                "fixtureSha256": sha256_file(FIXTURE),
                "title": fixture["title"],
            },
        )
        try:
            request = request_from_fixture(FIXTURE)
            coordinator = GenerationCoordinator(
                store,
                media_client=DeterministicMediaClient(),
                renderer_client=DeterministicRendererClient(),
            )
            with deny_pipeline_network():
                started = coordinator.start(request, generation_id=GENERATION_ID)
                if started.state is not GenerationState.QUEUED:
                    raise AssertionError(f"Expected QUEUED, got {started.state.value}")
                waiting = coordinator.run_pending()
                if waiting is None or waiting.state is not GenerationState.WAITING_APPROVAL:
                    raise AssertionError("Generation did not pause at approval")

                approval_payload = stage_payload(
                    coordinator, GENERATION_ID, GenerationStage.APPROVAL
                )
                if approval_payload["approval"]["approved"] is not False:
                    raise AssertionError("Preapproval payload was unexpectedly approved")
                write_json(output_directory / "approval-payload.json", approval_payload)

                approved = coordinator.approve(
                    GENERATION_ID,
                    name="Canonical Karatsuba evaluation approval",
                    message="Deterministic local evaluation approval; no cloud payload was sent",
                )
                if approved.approval_revision_id is None:
                    raise AssertionError("Approval did not create a revision")
                completed = coordinator.run_pending()
                if completed is None or completed.state is not GenerationState.SUCCEEDED:
                    state = "none" if completed is None else completed.state.value
                    raise AssertionError(f"Generation did not succeed: {state}")

            payloads = {
                stage: stage_payload(coordinator, GENERATION_ID, stage) for stage in ALL_STAGES
            }
            export_manifest = payloads[GenerationStage.EXPORT]["exportManifest"]
            if export_manifest["qualityGate"]["status"] != "PASS":
                raise AssertionError("Canonical quality gate did not pass")
            if completed.export_artifact_hash is None or not store.cas.verify(
                completed.export_artifact_hash
            ):
                raise AssertionError("Export manifest is missing from CAS")
            for file_entry in export_manifest["files"]:
                if not store.cas.verify(str(file_entry["artifactHash"])):
                    raise AssertionError(f"Missing export artifact: {file_entry['role']}")

            revisions = [
                revision
                for revision in store.list_revisions(limit=1_000)
                if revision.snapshot.get("generationId") == GENERATION_ID
            ]
            if len(revisions) != len(ALL_STAGES) + 1:
                raise AssertionError(
                    f"Expected {len(ALL_STAGES) + 1} generation revisions, got {len(revisions)}"
                )
            artifact_rows = [dict(row) for row in store.connection.execute("SELECT * FROM artifacts")]
            corrupt = [str(row["hash"]) for row in artifact_rows if not store.cas.verify(str(row["hash"]))]
            if corrupt:
                raise AssertionError(f"CAS verification failed: {', '.join(corrupt)}")

            archive_path = export_project(
                store,
                output_directory / "karatsuba-canonical.alytutorial",
                overwrite=True,
            )
            imported = import_project(archive_path, temporary_root / "Imported Karatsuba")
            try:
                imported_artifacts = list(imported.connection.execute("SELECT hash FROM artifacts"))
                if len(imported_artifacts) != len(artifact_rows):
                    raise AssertionError("Archive round trip changed the artifact inventory")
                if any(not imported.cas.verify(str(row["hash"])) for row in imported_artifacts):
                    raise AssertionError("Archive round trip contains a corrupt CAS object")
                if len(imported.list_revisions(limit=1_000)) != len(
                    store.list_revisions(limit=1_000)
                ):
                    raise AssertionError("Archive round trip changed revision history")
            finally:
                imported.close()

            pipeline_directory = output_directory / "pipeline"
            pipeline_hashes = {
                "input.json": write_json(pipeline_directory / "input.json", fixture),
                "evidence.json": write_json(
                    pipeline_directory / "evidence.json",
                    normalize_evidence(payloads[GenerationStage.INGEST_RESEARCH]),
                ),
                "learning-plan.json": write_json(
                    pipeline_directory / "learning-plan.json",
                    payloads[GenerationStage.LEARNING_PLAN]["learningPlan"],
                ),
                "script.json": write_json(
                    pipeline_directory / "script.json",
                    payloads[GenerationStage.SCRIPT]["scriptWorkflow"],
                ),
                "storyboard.json": write_json(
                    pipeline_directory / "storyboard.json",
                    payloads[GenerationStage.STORYBOARD]["storyboard"],
                ),
                "export-manifest.json": write_json(
                    pipeline_directory / "export-manifest.json",
                    normalize_export_manifest(export_manifest),
                ),
                "provenance.json": write_json(
                    pipeline_directory / "provenance.json",
                    compact_provenance(
                        fixture=fixture,
                        export_manifest=export_manifest,
                        artifact_rows=artifact_rows,
                    ),
                ),
            }
            expected_hashes_path = GOLDEN_DIRECTORY / "expected-hashes.json"
            if expected_hashes_path.is_file():
                expected_document = json.loads(expected_hashes_path.read_text(encoding="utf-8"))
                expected_hashes = expected_document.get("summaryFiles", {})
                mismatches = {
                    name: {"expected": expected_hashes.get(name), "actual": digest}
                    for name, digest in pipeline_hashes.items()
                    if expected_hashes.get(name) != digest
                }
                if mismatches:
                    raise AssertionError(
                        "Committed Karatsuba summaries drifted: "
                        + json.dumps(mismatches, sort_keys=True)
                    )
            write_json(
                pipeline_directory / "run-summary.json",
                {
                    "schemaVersion": 1,
                    "fixtureId": fixture["id"],
                    "generationId": GENERATION_ID,
                    "state": completed.state.value,
                    "approvalRecorded": True,
                    "approvalRevisionCreated": True,
                    "stageCount": len(completed.stages),
                    "generationRevisionCount": len(revisions),
                    "artifactCount": len(artifact_rows),
                    "casVerified": True,
                    "qualityGate": export_manifest["qualityGate"],
                    "archive": {
                        "path": archive_path.name,
                        "bytes": archive_path.stat().st_size,
                        "sha256": sha256_file(archive_path),
                        "roundTripVerified": True,
                    },
                    "summaryFileSha256": pipeline_hashes,
                },
            )

            if not args.skip_render:
                narration_item = payloads[GenerationStage.NARRATION]["narration"][0]
                narration_hash = str(narration_item["artifactHash"])
                store.cas.copy_to(
                    narration_hash, output_directory / "representative-narration.wav"
                )
                manifest = render_manifest(
                    payloads[GenerationStage.STORYBOARD]["storyboard"],
                    payloads[GenerationStage.NARRATION],
                    output_directory,
                )
                manifest_path = output_directory / "render-manifest.json"
                write_json(manifest_path, manifest)
                run_renderer(
                    output_directory=output_directory,
                    manifest_path=manifest_path,
                    runtime_path=args.runtime_manifest.expanduser().resolve(strict=True),
                    node=args.node,
                    chromium=args.chromium,
                    ffmpeg=args.ffmpeg,
                    ffprobe=args.ffprobe,
                )

        finally:
            store.close()

    print(
        canonical_json(
            {
                "status": "PASS",
                "fixture": fixture["id"],
                "outputDirectory": str(output_directory),
                "rendered": not args.skip_render,
                "networkCredentialsUsed": False,
            }
        ),
        end="",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
