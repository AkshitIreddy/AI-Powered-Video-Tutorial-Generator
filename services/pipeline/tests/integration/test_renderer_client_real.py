from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from alystria.audio import WavFixtureSpec, generate_sine_wav
from alystria.generation.renderer_client import (
    RendererOptions,
    create_production_renderer_client,
)
from alystria.project import ProjectStore


def _run_local_media_command(arguments: list[str], *, cwd: Path) -> None:
    completed = subprocess.run(
        arguments,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
        creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0),
    )
    assert completed.returncode == 0, completed.stderr


@pytest.mark.skipif(
    os.environ.get("ALYSTRIA_REAL_RENDERER_SMOKE") != "1",
    reason="Set ALYSTRIA_REAL_RENDERER_SMOKE=1 with exact runtime paths to run",
)
def test_current_renderer_cli_one_second_smoke(tmp_path: Path) -> None:
    repository_root = Path(__file__).parents[4]
    required = {
        name: os.environ.get(name)
        for name in (
            "ALYSTRIA_NODE_PATH",
            "ALYSTRIA_CHROMIUM_PATH",
            "ALYSTRIA_FFMPEG_PATH",
            "ALYSTRIA_FFPROBE_PATH",
        )
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        pytest.skip(f"Missing renderer runtime paths: {', '.join(missing)}")
    store = ProjectStore.create(tmp_path / "Renderer Smoke", name="Renderer Smoke")
    try:
        narration = store.add_artifact_bytes(
            generate_sine_wav(WavFixtureSpec(duration_ms=800, frequency_hz=220)),
            media_type="audio/wav",
        )
        client = create_production_renderer_client(
            store,
            repository_root=repository_root,
            node_path=Path(required["ALYSTRIA_NODE_PATH"] or ""),
            chromium_path=Path(required["ALYSTRIA_CHROMIUM_PATH"] or ""),
            ffmpeg_path=Path(required["ALYSTRIA_FFMPEG_PATH"] or ""),
            ffprobe_path=Path(required["ALYSTRIA_FFPROBE_PATH"] or ""),
            runtime_manifest_path=(
                Path(os.environ["ALYSTRIA_RUNTIME_MANIFEST_PATH"])
                if os.environ.get("ALYSTRIA_RUNTIME_MANIFEST_PATH")
                else None
            ),
            options=RendererOptions(
                codec="vp9",
                concurrency=1,
                chunk_frames=24,
                timeout_seconds=180,
            ),
        )
        rendered = client.render(
            {
                "schemaVersion": 1,
                "generationId": "f2fd65a7-193b-4204-ae98-ce1ae052f262",
                "timebase": 240_000,
                "seed": 1,
                "targets": [{"name": "landscape", "width": 64, "height": 64, "fps": 24}],
                "scenes": [
                    {
                        "id": "smoke-scene",
                        "type": "title",
                        "title": "Renderer smoke",
                        "narration": "One exact second.",
                        "durationTicks": 240_000,
                    }
                ],
                "narration": [
                    {
                        "sceneId": "smoke-scene",
                        "artifactHash": narration.hash,
                        "mediaType": "audio/wav",
                        "durationMs": 800,
                    }
                ],
                "captions": {"captionsEnabled": False, "byScene": {}},
            }
        )
        assert rendered.content
        assert rendered.metrics["frameCount"] == 24
        assert rendered.metrics["audioSampleRateHz"] == 48_000
    finally:
        store.close()


@pytest.mark.skipif(
    os.environ.get("ALYSTRIA_REAL_MULTI_PRESENTER_SMOKE") != "1",
    reason="Set ALYSTRIA_REAL_MULTI_PRESENTER_SMOKE=1 with the installed runtime pack",
)
def test_current_renderer_cli_routes_two_bundled_presenters(tmp_path: Path) -> None:
    """CPU-only integration proof for scene-to-presenter composition.

    The presenter inputs are one-second static fixture clips made from bundled
    portraits. This validates CAS staging, renderer-manifest routing, Chromium
    scene rendering, and FFmpeg composition. It does not claim animation or
    lip-sync qualification for either portrait style.
    """

    repository_root = Path(__file__).parents[4]
    runtime_pack = Path(os.environ["ALYSTRIA_RUNTIME_PACK_ROOT"])
    ffmpeg = Path(os.environ["ALYSTRIA_FFMPEG_PATH"])
    evidence_value = os.environ.get("ALYSTRIA_MULTI_PRESENTER_SMOKE_OUTPUT")
    evidence_root = Path(evidence_value) if evidence_value else None
    media_root = tmp_path / "media"
    media_root.mkdir()
    portraits = [
        (
            "presenter-broadcast-elena-v1",
            repository_root
            / "apps"
            / "desktop"
            / "src"
            / "assets"
            / "presenters"
            / "broadcast-elena-v1.webp",
        ),
        (
            "presenter-anime-astrid-v1",
            repository_root
            / "apps"
            / "desktop"
            / "src"
            / "assets"
            / "presenters"
            / "anime-astrid-v1.webp",
        ),
    ]
    clips: list[tuple[str, Path]] = []
    for presenter_id, portrait in portraits:
        clip = media_root / f"{presenter_id}.mp4"
        _run_local_media_command(
            [
                str(ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-y",
                "-loop",
                "1",
                "-i",
                str(portrait),
                "-t",
                "1",
                "-vf",
                "fps=10,format=yuv420p",
                "-an",
                "-c:v",
                "mpeg4",
                "-q:v",
                "2",
                str(clip),
            ],
            cwd=media_root,
        )
        clips.append((presenter_id, clip))

    store = ProjectStore.create(tmp_path / "Two Presenter Smoke", name="Two Presenter Smoke")
    try:
        narration = [
            store.add_artifact_bytes(
                generate_sine_wav(WavFixtureSpec(duration_ms=800, frequency_hz=frequency)),
                media_type="audio/wav",
            )
            for frequency in (220, 330)
        ]
        presenter_artifacts = [
            store.add_artifact_bytes(
                clip.read_bytes(),
                media_type="video/mp4",
                original_name=clip.name,
                metadata={"fixture": True, "presenterId": presenter_id},
            )
            for presenter_id, clip in clips
        ]
        client = create_production_renderer_client(
            store,
            runtime_pack_root=runtime_pack,
            options=RendererOptions(
                codec="vp9",
                concurrency=1,
                chunk_frames=10,
                timeout_seconds=180,
            ),
        )
        scenes = [
            {
                "id": "scene-elena",
                "type": "presenter-slide",
                "title": "Elena explains the first idea",
                "narration": "Elena introduces the first idea.",
                "durationTicks": 240_000,
                "presenterId": portraits[0][0],
            },
            {
                "id": "scene-astrid",
                "type": "presenter-slide",
                "title": "Astrid explains the second idea",
                "narration": "Astrid continues with the second idea.",
                "durationTicks": 240_000,
                "presenterId": portraits[1][0],
            },
        ]
        rendered = client.render(
            {
                "schemaVersion": 1,
                "generationId": "f2fd65a7-193b-4204-ae98-ce1ae052f263",
                "timebase": 240_000,
                "seed": 2,
                "targets": [{"name": "landscape", "width": 320, "height": 180, "fps": 10}],
                "scenes": scenes,
                "narration": [
                    {
                        "sceneId": scene["id"],
                        "artifactHash": audio.hash,
                        "mediaType": "audio/wav",
                        "durationMs": 800,
                    }
                    for scene, audio in zip(scenes, narration, strict=True)
                ],
                "presenters": [
                    {
                        "sceneId": scene["id"],
                        "presenterId": presenter_id,
                        "artifactHash": artifact.hash,
                        "activeDurationTicks": 240_000,
                        "direction": {"placement": "picture_in_picture"},
                    }
                    for scene, (presenter_id, _), artifact in zip(
                        scenes, clips, presenter_artifacts, strict=True
                    )
                ],
                "captions": {"captionsEnabled": False, "byScene": {}},
            }
        )
        assert rendered.metrics["frameCount"] == 20
        delivery = media_root / "two-presenter-delivery.webm"
        delivery.write_bytes(rendered.content)
        frames: list[Path] = []
        for label, timestamp in (("scene-elena", "0.5"), ("scene-astrid", "1.5")):
            frame = media_root / f"{label}.png"
            _run_local_media_command(
                [
                    str(ffmpeg),
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    "-ss",
                    timestamp,
                    "-i",
                    str(delivery),
                    "-frames:v",
                    "1",
                    str(frame),
                ],
                cwd=media_root,
            )
            frames.append(frame)
        frame_hashes = [hashlib.sha256(frame.read_bytes()).hexdigest() for frame in frames]
        assert frame_hashes[0] != frame_hashes[1]
        if evidence_root is not None:
            evidence_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(delivery, evidence_root / delivery.name)
            for frame in frames:
                shutil.copy2(frame, evidence_root / frame.name)
            (evidence_root / "integrated-evidence.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "kind": "cpu-fixture-multi-presenter-integrated-render",
                        "scope": (
                            "Static fixture clips and synthetic PCM validate per-scene CAS, "
                            "renderer, and compositor routing; animation and lip-sync are not claimed."
                        ),
                        "sceneAssignments": [
                            {"sceneId": scene["id"], "presenterId": presenter_id}
                            for scene, (presenter_id, _) in zip(scenes, clips, strict=True)
                        ],
                        "frameSha256": dict(
                            zip((frame.name for frame in frames), frame_hashes, strict=True)
                        ),
                        "deliverySha256": hashlib.sha256(rendered.content).hexdigest(),
                        "metrics": rendered.metrics,
                    },
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
    finally:
        store.close()
