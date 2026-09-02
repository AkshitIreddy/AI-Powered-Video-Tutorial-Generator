#!/usr/bin/env python3
"""Resume a failed quality run from its matching ElevenLabs audio artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.audio import measure_wav
from alystria.generation import (
    GeneratedMedia,
    GenerationCoordinator,
    GenerationStage,
    GenerationState,
    RendererOptions,
    create_production_renderer_client,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore

SOURCE_SPEED = 0.74
TARGET_SPEED = 0.86
ATEMPO = TARGET_SPEED / SOURCE_SPEED


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--generation-id", required=True)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument("--presenter-config", required=True, type=Path)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


class CachedAliceRecoveryMediaClient:
    """Replay matching provider output through a pinned tempo-only transform."""

    provider_id = "elevenlabs"
    model_revision = "eleven_multilingual_v2"

    def __init__(self, store: ProjectStore, ffmpeg: Path) -> None:
        self.store = store
        self.ffmpeg = ffmpeg.resolve(strict=True)
        self.recovery_root = store.root / "staging" / "cached-alice-recovery"
        self.recovery_root.mkdir(parents=True, exist_ok=True)
        self.audio_by_scene: dict[str, tuple[str, str]] = {}
        rows = store.connection.execute(
            "SELECT hash,metadata_json FROM artifacts WHERE media_type='audio/mpeg'"
        ).fetchall()
        for row in rows:
            metadata = json.loads(str(row["metadata_json"]))
            scene_id = metadata.get("sceneId")
            if isinstance(scene_id, str) and scene_id:
                self.audio_by_scene[scene_id] = (str(row["hash"]), str(row["metadata_json"]))

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        del scene, seed
        raise RuntimeError("Cached recovery must not rerun the completed visual-asset stage")

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        del seed
        scene_id = str(scene["id"])
        try:
            source_hash, source_metadata_json = self.audio_by_scene[scene_id]
        except KeyError as error:
            raise RuntimeError(f"No matching cached Alice narration exists for {scene_id}") from error
        source_metadata = json.loads(source_metadata_json)
        expected_text_hash = hashlib.sha256(str(scene["narration"]).encode()).hexdigest()
        if source_metadata.get("textSha256") != expected_text_hash:
            raise RuntimeError(f"Cached Alice narration text does not match {scene_id}")
        if not self.store.cas.verify(source_hash):
            raise RuntimeError(f"Cached Alice narration is corrupt for {scene_id}")

        scene_root = self.recovery_root / scene_id
        scene_root.mkdir(parents=True, exist_ok=True)
        source_path = scene_root / "source.mp3"
        output_path = scene_root / "alice-speed-0.86.wav"
        self.store.cas.copy_to(source_hash, source_path)
        creation_flags = int(getattr(subprocess, "CREATE_NO_WINDOW", 0))
        completed = subprocess.run(
            (
                str(self.ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(source_path),
                "-filter:a",
                f"atempo={ATEMPO:.12f}",
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(output_path),
            ),
            cwd=scene_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            creationflags=creation_flags,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                "Pinned FFmpeg could not retime cached Alice narration: "
                + completed.stderr.decode("utf-8", errors="replace")[-2_000:]
            )
        content = output_path.read_bytes()
        measured = measure_wav(content)
        return GeneratedMedia(
            content,
            "audio/wav",
            f"{scene_id}.alice-0.86.wav",
            self.provider_id,
            self.model_revision,
            {
                "origin": "generated",
                "rightsStatus": source_metadata.get("rightsStatus", "unknown"),
                "licenseId": source_metadata.get("licenseId", "UNKNOWN"),
                "locale": locale,
                "voiceId": "Xb7hH8MSUJpSbSDYk0k2",
                "voiceName": "Alice",
                "speed": TARGET_SPEED,
                "sourceSpeed": SOURCE_SPEED,
                "sourceArtifactHash": source_hash,
                "recoveryTransform": "ffmpeg-atempo-pitch-preserving",
                "ffmpegSha256": sha256_file(self.ffmpeg),
                "durationMs": round(measured.duration_ms),
                "sampleRateHz": measured.sample_rate_hz,
                "channels": measured.channels,
                "durationSource": "decoded-audio-frames",
            },
            0,
            {"characters": float(len(str(scene["narration"])))},
        )

    def create_presenter(
        self, scene: dict[str, Any], *, narration_hash: str, seed: int
    ) -> GeneratedMedia | None:
        del scene, narration_hash, seed
        return None


def prepare_presenter_config(output: Path, base_config: Path) -> Path:
    runtime_adapter = Path(
        r"E:\temp\Alystria Studio\models\musetalk-runtime\worker\musetalk_v15_adapter.py"
    )
    source_adapter = ROOT / "services" / "pipeline" / "scripts" / "musetalk_v15_adapter.py"
    shutil.copy2(source_adapter, runtime_adapter)
    adapter_hash = sha256_file(runtime_adapter)
    config = json.loads(base_config.resolve(strict=True).read_text(encoding="utf-8"))
    config["defaultProfileId"] = "presenter-portrait.academic-amara-v1"
    config["profiles"] = [
        {
            "profileId": "presenter-portrait.academic-amara-v1",
            "portraitArtifactHash": "a168260c6087a80752c313adfb8d0f0440576fe916549f96acff4542b7714614",
            "subjectId": "fictional-synthetic-academic-amara-v1",
        }
    ]
    config["modelRevision"] = (
        f"musetalk-1.5+identity-lip-aperture-{adapter_hash[:12]}"
    )
    adapter_record = next(
        item
        for item in config["workerContract"]["files"]
        if item.get("role") == "adapter-entrypoint"
    )
    adapter_record["sha256"] = adapter_hash
    config["installFingerprint"] = hashlib.sha256(
        json.dumps(config["workerContract"], sort_keys=True).encode()
    ).hexdigest()
    path = output / "presenter-runtime-amara.json"
    path.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


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


def main() -> int:
    options = arguments()
    project_root = options.project_root.resolve(strict=True)
    output = project_root.parent
    runtime_pack = options.runtime_pack.resolve(strict=True)
    store = ProjectStore.open(project_root)
    try:
        base_media = CachedAliceRecoveryMediaClient(
            store, runtime_pack / "ffmpeg" / "ffmpeg.exe"
        )
        presenter_config = prepare_presenter_config(output, options.presenter_config)
        media = load_local_presenter_media_client(store, base_media, presenter_config)
        renderer = create_production_renderer_client(
            store,
            repository_root=ROOT,
            runtime_manifest_path=ROOT / "runtime-manifest.json",
            node_path=runtime_pack / "node" / "node.exe",
            chromium_path=runtime_pack / "chromium" / "chrome.exe",
            ffmpeg_path=runtime_pack / "ffmpeg" / "ffmpeg.exe",
            ffprobe_path=runtime_pack / "ffmpeg" / "ffprobe.exe",
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
            store, media_client=media, renderer_client=renderer
        )
        retried = coordinator.retry(options.generation_id)
        if retried.state is not GenerationState.QUEUED:
            raise RuntimeError(f"Narration retry did not queue: {retried.state.value}")
        completed = coordinator.run_pending()
        if completed is None or completed.state is not GenerationState.SUCCEEDED:
            raise RuntimeError(f"Recovered generation failed: {completed}")
        narration = stage_payload(coordinator, options.generation_id, GenerationStage.NARRATION)
        (output / "measured-storyboard.json").write_text(
            json.dumps(narration["storyboard"], indent=2, ensure_ascii=False, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        exported = stage_payload(coordinator, options.generation_id, GenerationStage.EXPORT)
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
            "generationId": options.generation_id,
            "durationSeconds": 180,
            "voice": {
                "provider": "elevenlabs",
                "model": "eleven_multilingual_v2",
                "voiceId": "Xb7hH8MSUJpSbSDYk0k2",
                "name": "Alice",
                "speed": TARGET_SPEED,
                "recovery": "matching provider audio retimed with pinned FFmpeg atempo",
            },
            "presenter": {
                "profileId": "presenter-portrait.academic-amara-v1",
                "name": "Amara",
            },
            "writing": {"provider": "nvidia-nim", "model": "openai/gpt-oss-20b"},
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
