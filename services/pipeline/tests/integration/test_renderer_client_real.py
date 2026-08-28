from __future__ import annotations

import os
from pathlib import Path

import pytest

from alystria.audio import WavFixtureSpec, generate_sine_wav
from alystria.generation.renderer_client import (
    RendererOptions,
    create_production_renderer_client,
)
from alystria.project import ProjectStore


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
