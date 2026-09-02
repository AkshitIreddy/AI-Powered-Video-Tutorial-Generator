#!/usr/bin/env python3
"""Resume the accurate three-minute candidate after its cached AI stages."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation import (
    DeterministicMediaClient,
    GenerationCoordinator,
    GenerationStage,
    GenerationState,
    RendererOptions,
    create_production_renderer_client,
)
from alystria.project import ProjectStore

TIMEBASE = 240_000
ALICE_VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument(
        "--invalidate-render",
        action="store_true",
        help="Invalidate render and downstream stages after a renderer-only fix.",
    )
    return parser.parse_args()


def stage_payload(
    coordinator: GenerationCoordinator, generation_id: str, stage: GenerationStage
) -> dict[str, Any]:
    job = next(
        item
        for item in coordinator._jobs(generation_id)
        if item.parameters.get("stage") == stage.value
    )
    if job.result is None or not isinstance(job.result.get("payload"), dict):
        raise RuntimeError(f"Stage {stage.value} has no payload")
    return job.result["payload"]


def repair_render_audio_contract(store: ProjectStore, generation_id: str) -> int:
    """Replace only the rejected test-harness audio shape in pending stages."""

    rows = store.connection.execute(
        "SELECT job_id,parameters_json FROM jobs "
        "WHERE json_extract(parameters_json, '$.generationId')=?",
        (generation_id,),
    ).fetchall()
    replacements: list[tuple[str, str]] = []
    current_contract_seen = False
    for row in rows:
        parameters = json.loads(str(row["parameters_json"]))
        request = parameters.get("request")
        metadata = request.get("metadata") if isinstance(request, dict) else None
        audio = (
            metadata.get("audioCustomization") if isinstance(metadata, dict) else None
        )
        if isinstance(audio, dict) and audio.get("mix") == {"musicDuckingDb": -12.96}:
            current_contract_seen = True
            continue
        if not isinstance(audio, dict) or "narrationDucking" not in audio:
            continue
        if audio.get("music") is not None or audio.get("sfx") is not None:
            raise ValueError(
                "Recovery refuses to rewrite a request with selected program audio"
            )
        if float(audio["narrationDucking"]) not in {0.72, 72.0}:
            raise ValueError("Recovery found an unexpected narration-ducking value")
        metadata["audioCustomization"] = {
            "schemaVersion": 1,
            "inputs": [],
            "mix": {"musicDuckingDb": -12.96},
        }
        replacements.append(
            (
                json.dumps(parameters, sort_keys=True, separators=(",", ":")),
                str(row["job_id"]),
            )
        )
    if not replacements and current_contract_seen:
        return 0
    if not replacements:
        raise RuntimeError(
            "No rejected audio customization contract remained to repair"
        )
    with store.connection:
        store.connection.executemany(
            "UPDATE jobs SET parameters_json=? WHERE job_id=?", replacements
        )
    return len(replacements)


def main() -> int:
    options = arguments()
    output = options.output_root.resolve(strict=True)
    runtime_pack = options.runtime_pack.resolve(strict=True)
    store = ProjectStore.open(output / "project")
    try:
        row = store.connection.execute(
            "SELECT json_extract(parameters_json, '$.generationId') AS generation_id "
            "FROM jobs LIMIT 1"
        ).fetchone()
        if row is None or not isinstance(row["generation_id"], str):
            raise RuntimeError("Project has no generation to resume")
        generation_id = str(row["generation_id"])
        repaired_jobs = repair_render_audio_contract(store, generation_id)
        renderer = create_production_renderer_client(
            store,
            repository_root=ROOT,
            runtime_manifest_path=ROOT / "runtime-manifest.json",
            node_path=runtime_pack / "node" / "node.exe",
            chromium_path=runtime_pack / "chromium" / "chrome.exe",
            ffmpeg_path=runtime_pack / "ffmpeg" / "ffmpeg.exe",
            ffprobe_path=runtime_pack / "ffmpeg" / "ffprobe.exe",
            renderer_cli_path=ROOT
            / "services"
            / "renderer"
            / "dist"
            / "src"
            / "cli.js",
            options=RendererOptions(
                codec="vp9",
                quality=31,
                # Two software-rendered pages proved stable on the Windows
                # reference host while four hardware-composited contexts can
                # terminate Chromium during a long 1080p capture.
                concurrency=2,
                chunk_frames=180,
                timeout_seconds=10_800,
                caption_delivery_mode="sidecar",
            ),
        )
        coordinator = GenerationCoordinator(
            store,
            media_client=DeterministicMediaClient(),
            renderer_client=renderer,
        )
        coordinator.runtime.recover_expired()
        if options.invalidate_render:
            coordinator.invalidate_scope(generation_id, "render")
            renderer_dependent_stages = {
                GenerationStage.RENDER.value,
                GenerationStage.QA_INITIAL.value,
                GenerationStage.REPAIR_ONE.value,
                GenerationStage.QA_ONE.value,
                GenerationStage.REPAIR_TWO.value,
                GenerationStage.QA_FINAL.value,
                GenerationStage.EXPORT.value,
            }
            for job in coordinator._jobs(generation_id):
                stage = job.parameters.get("stage")
                if (
                    isinstance(stage, str)
                    and stage in renderer_dependent_stages
                    and job.state.value == "SUCCEEDED"
                ):
                    coordinator.runtime.mark_stale(
                        job.job_id,
                        reason="renderer_implementation_changed",
                    )
        queued = coordinator.retry(generation_id)
        if queued.state not in {GenerationState.RUNNING, GenerationState.QUEUED}:
            raise RuntimeError(f"Render retry did not queue: {queued.state.value}")
        completed = coordinator.run_pending()
        if completed is None or completed.state is not GenerationState.SUCCEEDED:
            raise RuntimeError(f"Accurate render retry failed: {completed}")

        narration = stage_payload(coordinator, generation_id, GenerationStage.NARRATION)
        measured_storyboard = narration["storyboard"]
        if (
            sum(int(scene["durationTicks"]) for scene in measured_storyboard["scenes"])
            != 180 * TIMEBASE
        ):
            raise RuntimeError("Measured narration fit is not exactly 180 seconds")
        (output / "measured-storyboard.json").write_text(
            json.dumps(
                measured_storyboard, indent=2, ensure_ascii=False, sort_keys=True
            )
            + "\n",
            encoding="utf-8",
        )

        exported = stage_payload(coordinator, generation_id, GenerationStage.EXPORT)
        manifest = exported["exportManifest"]
        delivered: dict[str, str] = {}
        for item in manifest["files"]:
            role = str(item["role"])
            suffix = {
                "video": ".webm",
                "captions": ".vtt",
                "captions-srt": ".srt",
                "transcript": ".txt",
            }[role]
            destination = output / f"alystria-karatsuba-3min-female-quality{suffix}"
            store.cas.copy_to(str(item["artifactHash"]), destination)
            delivered[role] = str(destination)
        report = {
            "schemaVersion": 1,
            "generationId": generation_id,
            "durationSeconds": 180,
            "recovery": {
                "repairedJobParameters": repaired_jobs,
                "reranAiStages": False,
            },
            "voice": {
                "provider": "elevenlabs",
                "model": "eleven_multilingual_v2",
                "voiceId": ALICE_VOICE_ID,
                "name": "Alice",
                "speed": 0.86,
                "composition": "four exact v11 clips plus two exact v9 clips retimed with pinned FFmpeg atempo",
            },
            "presenter": {
                "profileId": "presenter-portrait.academic-amara-v1",
                "name": "Amara",
                "mouthMask": "raw identity-preserving MuseTalk mask",
            },
            "writing": {
                "provider": "nvidia-nim",
                "model": "openai/gpt-oss-20b",
                "composition": "accurate six-scene v11 result plus factually equivalent v9 complexity and recap narration",
            },
            "images": {
                "provider": "nvidia-nim",
                "model": "black-forest-labs/flux.2-klein-4b",
                "composition": "six exact v11 supporting-art candidates preserved in provenance",
                "rendered": False,
                "renderPolicy": (
                    "Generated backgrounds were suppressed because visual review found glyph-like "
                    "pseudo-text; Alystria-rendered semantic diagrams and typography remain authoritative."
                ),
            },
            "qualityGate": manifest["qualityGate"],
            "files": delivered,
        }
        (output / "quality-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
