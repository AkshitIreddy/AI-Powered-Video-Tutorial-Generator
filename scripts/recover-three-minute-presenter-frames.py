#!/usr/bin/env python3
"""Finish a failed three-minute run from an already-assembled presenter clip.

This recovery path is intentionally narrow: it retries the failed presenter
stage with a verified local MP4, then lets the normal renderer, QA, repair, and
export stages continue.  It never calls a speech, image, or presenter model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, NoReturn

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation import (
    GeneratedMedia,
    GenerationCoordinator,
    GenerationStage,
    GenerationState,
    RendererOptions,
    create_production_renderer_client,
)
from alystria.project import ProjectStore

TIMEBASE = 240_000


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--generation-id", required=True)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument("--presenter-video", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--output-stem", required=True)
    parser.add_argument("--presenter-id", required=True)
    parser.add_argument("--presenter-name", required=True)
    return parser.parse_args()


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def probe_video(path: Path, ffprobe: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    value = json.loads(completed.stdout)
    streams = value.get("streams")
    if not isinstance(streams, list):
        fail("Recovered presenter probe has no streams")
    video = next(
        (item for item in streams if item.get("codec_type") == "video"), None
    )
    audio = next(
        (item for item in streams if item.get("codec_type") == "audio"), None
    )
    if not isinstance(video, dict) or not isinstance(audio, dict):
        fail("Recovered presenter must contain video and audio")
    if video.get("codec_name") != "h264" or audio.get("codec_name") != "aac":
        fail("Recovered presenter codecs do not match the H.264/AAC contract")
    duration = float(value.get("format", {}).get("duration", 0))
    if duration <= 0:
        fail("Recovered presenter duration is invalid")
    return {
        "durationSeconds": duration,
        "width": int(video["width"]),
        "height": int(video["height"]),
        "frameRate": str(video["r_frame_rate"]),
        "videoCodec": str(video["codec_name"]),
        "audioCodec": str(audio["codec_name"]),
        "byteSize": int(value["format"]["size"]),
    }


class RecoveredPresenterMedia:
    """Supply only the verified presenter artifact needed by the failed stage."""

    provider_id = "local-presenter"
    model_revision = "musetalk-1.5+identity-lip-aperture+recovered-frames-v1"

    def __init__(
        self,
        video: Path,
        probe: dict[str, Any],
        presenter_id: str,
    ) -> None:
        self.content = video.read_bytes()
        self.probe = probe
        self.presenter_id = presenter_id
        self.digest = hashlib.sha256(self.content).hexdigest()

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        del scene, seed
        fail("Recovery unexpectedly requested a new visual")

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        del scene, locale, seed
        fail("Recovery unexpectedly requested new narration")

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia:
        return GeneratedMedia(
            content=self.content,
            media_type="video/mp4",
            original_name=f"{scene['id']}.presenter.mp4",
            provider_id=self.provider_id,
            model_revision=self.model_revision,
            metadata={
                "rightsStatus": "owned",
                "licenseId": "USER-OWNED",
                "localOnly": True,
                "synthetic": True,
                "disclosureRequired": True,
                "provider": self.provider_id,
                "modelId": "musetalk-1.5",
                "modelRevision": self.model_revision,
                "presenterProfileId": self.presenter_id,
                "narrationArtifactHash": narration_hash,
                "outputSha256": self.digest,
                "probe": self.probe,
                "recoveredFromCompletedFrames": True,
                "seed": seed,
            },
            actual_cost_micros=0,
            usage_units={"seconds": float(self.probe["durationSeconds"])},
        )


def stage_payload(
    coordinator: GenerationCoordinator,
    generation_id: str,
    stage: GenerationStage,
) -> dict[str, Any]:
    job = next(
        item
        for item in coordinator._jobs(generation_id)
        if item.parameters.get("stage") == stage.value
    )
    if job.result is None or not isinstance(job.result.get("payload"), dict):
        fail(f"Stage {stage.value} has no payload")
    return job.result["payload"]


def main() -> int:
    options = arguments()
    project_root = options.project_root.resolve(strict=True)
    runtime_pack = options.runtime_pack.resolve(strict=True)
    presenter_video = options.presenter_video.resolve(strict=True)
    output_root = options.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    ffprobe = runtime_pack / "ffmpeg" / "ffprobe.exe"
    probe = probe_video(presenter_video, ffprobe.resolve(strict=True))

    store = ProjectStore.open(project_root)
    try:
        media = RecoveredPresenterMedia(
            presenter_video, probe, options.presenter_id
        )
        renderer = create_production_renderer_client(
            store,
            repository_root=ROOT,
            runtime_manifest_path=ROOT / "runtime-manifest.json",
            node_path=runtime_pack / "node" / "node.exe",
            chromium_path=runtime_pack / "chromium" / "chrome.exe",
            ffmpeg_path=runtime_pack / "ffmpeg" / "ffmpeg.exe",
            ffprobe_path=ffprobe,
            renderer_cli_path=ROOT / "services" / "renderer" / "dist" / "src" / "cli.js",
            options=RendererOptions(
                codec="vp9",
                quality=31,
                concurrency=4,
                chunk_frames=180,
                timeout_seconds=10_800,
                caption_delivery_mode="sidecar",
            ),
        )
        coordinator = GenerationCoordinator(
            store,
            media_client=media,
            renderer_client=renderer,
        )
        before = coordinator.status(options.generation_id)
        if before.state is GenerationState.FAILED:
            coordinator.retry(options.generation_id)
        completed = coordinator.run_pending()
        if completed is None or completed.state is not GenerationState.SUCCEEDED:
            fail(f"Recovered generation did not succeed: {completed}")

        narration = stage_payload(
            coordinator, options.generation_id, GenerationStage.NARRATION
        )
        measured_storyboard = narration["storyboard"]
        if sum(
            int(scene["durationTicks"])
            for scene in measured_storyboard["scenes"]
        ) != 180 * TIMEBASE:
            fail("Recovered storyboard no longer totals exactly 180 seconds")
        (output_root / "measured-storyboard.json").write_text(
            json.dumps(measured_storyboard, indent=2, ensure_ascii=False, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )

        exported = stage_payload(
            coordinator, options.generation_id, GenerationStage.EXPORT
        )
        manifest = exported["exportManifest"]
        delivered: dict[str, str] = {}
        suffixes = {
            "video": ".webm",
            "captions": ".vtt",
            "captions-srt": ".srt",
            "transcript": ".txt",
        }
        for item in manifest["files"]:
            role = str(item["role"])
            destination = output_root / f"{options.output_stem}{suffixes[role]}"
            store.cas.copy_to(str(item["artifactHash"]), destination)
            delivered[role] = str(destination)

        report = {
            "schemaVersion": 1,
            "generationId": options.generation_id,
            "durationSeconds": 180,
            "voice": {
                "provider": "elevenlabs",
                "model": "eleven_multilingual_v2",
                "voiceId": "Xb7hH8MSUJpSbSDYk0k2",
                "name": "Alice",
                "presenterMatched": True,
            },
            "presenter": {
                "profileId": options.presenter_id,
                "name": options.presenter_name,
                "mouthMask": "raw identity-preserving MuseTalk lip-aperture mask",
                "source": "877 completed inference frames",
                "probe": probe,
                "sha256": sha256_file(presenter_video),
            },
            "qualityGate": manifest["qualityGate"],
            "files": delivered,
        }
        (output_root / "quality-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True))
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
