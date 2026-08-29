from __future__ import annotations

import hashlib
import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.renderer_client import (
    CommandResult,
    PinnedExecutable,
    RendererCancelledError,
    RendererOptions,
    RendererOutputError,
    RendererRuntimeError,
    RendererRuntimePins,
    RendererTimeoutError,
    SubprocessCommandRunner,
    SubprocessRendererClient,
    create_production_renderer_client,
)
from alystria.project import ProjectStore
from alystria.service import _production_renderer_client

ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c02"
    "0000000b4944415478da6364f80f00010501312718e3600000000049454e44ae426082"
)


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_runtime_file(root: Path, name: str, content: bytes) -> Path:
    path = root / name
    path.write_bytes(content)
    return path.resolve()


def runtime_pins(root: Path) -> RendererRuntimePins:
    node = write_runtime_file(root, "node", b"node-24.20.0")
    cli = write_runtime_file(root, "cli.js", b"renderer-cli")
    chromium = write_runtime_file(root, "chromium", b"chromium-151")
    ffmpeg = write_runtime_file(root, "ffmpeg", b"ffmpeg-9.0.1")
    ffprobe = write_runtime_file(root, "ffprobe", b"ffprobe-9.0.1")
    return RendererRuntimePins(
        node=PinnedExecutable(node, "24.20.0", digest(node), ("--version",)),
        renderer_cli_path=cli,
        renderer_cli_sha256=digest(cli),
        chromium=PinnedExecutable(
            chromium,
            "151.0.7922.34",
            digest(chromium),
            ("--version",),
        ),
        ffmpeg=PinnedExecutable(ffmpeg, "9.0.1", digest(ffmpeg), ("-version",)),
        ffprobe=PinnedExecutable(ffprobe, "9.0.1", digest(ffprobe), ("-version",)),
        renderer_version="2.0.0-rc.0",
    )


@dataclass
class FakeRendererRunner:
    pins: RendererRuntimePins
    output_mode: str = "valid"
    calls: list[tuple[list[str], Path, float]] = field(default_factory=list)
    render_manifest: dict[str, Any] | None = None
    attempt_root: Path | None = None

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        self.calls.append((list(argv), cwd, timeout_seconds))
        if cancelled():
            raise RendererCancelledError("cancelled by fake runner")
        executable = Path(argv[0]).resolve()
        if executable == self.pins.node.path.resolve() and list(argv[1:]) == ["--version"]:
            return CommandResult(0, "v24.20.0\n", "")
        if executable == self.pins.ffmpeg.path.resolve() and list(argv[1:]) == ["-version"]:
            return CommandResult(0, "ffmpeg version 9.0.1\n", "")
        if executable == self.pins.ffprobe.path.resolve() and list(argv[1:]) == ["-version"]:
            return CommandResult(0, "ffprobe version 9.0.1\n", "")
        assert argv[0] == str(self.pins.node.path)
        assert argv[1] == str(self.pins.renderer_cli_path)
        assert argv[2] == "render"
        assert argv[4:7] == ["--mode", "full", "--output-dir"]
        assert "--browser-version" in argv
        assert "--browser-sha256" in argv
        assert "--ffmpeg" in argv
        assert "--ffprobe" in argv
        assert "--discard-frame-cache" in argv
        manifest_path = Path(argv[3])
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert isinstance(manifest, dict)
        self.render_manifest = manifest
        self.attempt_root = cwd
        for audio in manifest["audioInputs"]:
            audio_path = Path(audio["path"])
            assert audio_path.is_file()
            assert digest(audio_path) == audio["sha256"]
            audio_path.resolve().relative_to(cwd.resolve())
        for presenter in manifest.get("presenterVideos", []):
            presenter_path = Path(presenter["path"])
            assert presenter_path.is_file()
            assert digest(presenter_path) == presenter["sha256"]
            presenter_path.resolve().relative_to(cwd.resolve())
        for visual in manifest.get("visualAssets", []):
            visual_path = Path(visual["path"])
            assert visual_path.is_file()
            assert digest(visual_path) == visual["sha256"]
            visual_path.resolve().relative_to(cwd.resolve())
        for font in manifest.get("fontAssets", []):
            font_path = Path(font["path"])
            assert font_path.is_file()
            assert digest(font_path) == font["sha256"]
            font_path.resolve().relative_to(cwd.resolve())
        output_root = Path(argv[argv.index("--output-dir") + 1])
        output_name = argv[argv.index("--output") + 1]
        delivery_path = output_root / output_name
        delivery_path.write_bytes(b"deterministic-delivery")
        duration_ticks = sum(int(scene["durationTicks"]) for scene in manifest["scenes"])
        frame_rate = manifest["target"]["frameRate"]
        fps = frame_rate["numerator"] / frame_rate["denominator"]
        output_file = delivery_path
        if self.output_mode == "escape":
            output_file = cwd.parent.parent.parent / "manifest.json"
        record = {
            "kind": "delivery",
            "path": str(output_file),
            "bytes": output_file.stat().st_size,
            "sha256": digest(output_file),
        }
        output = {
            "schemaVersion": 1,
            "manifestId": manifest["id"],
            "inputManifestSha256": hashlib.sha256(canonical(manifest).encode()).hexdigest(),
            "renderKey": "a" * 64,
            "selection": {"kind": "full"},
            "frameRange": {"startFrame": 0, "endFrame": int(duration_ticks / 240_000 * fps)},
            "frameCount": int(duration_ticks / 240_000 * fps),
            "startTick": 0,
            "durationTicks": duration_ticks,
            "target": manifest["target"],
            "browser": {
                "executablePath": str(self.pins.chromium.path),
                "version": self.pins.chromium.version,
                "sha256": self.pins.chromium.sha256,
                "networkPolicy": "deny",
            },
            "executables": {
                "ffmpeg": str(self.pins.ffmpeg.path),
                "ffprobe": str(self.pins.ffprobe.path),
            },
            "frames": [],
            "files": [record],
            "probe": {
                "videoCodec": "vp9",
                "width": manifest["target"]["width"],
                "height": manifest["target"]["height"],
                "frameRate": "30/1",
                "durationSeconds": duration_ticks / 240_000,
                "audioCodec": "opus",
                "audioSampleRate": 48_000,
                "audioChannels": 2,
                "captionCodec": "webvtt",
                "colorSpace": "bt709",
                "colorTransfer": "iec61966-2-1",
                "colorPrimaries": "bt709",
            },
            "qaMetrics": {
                "integratedLufs": -16.0,
                "truePeakDbtp": -1.5,
                "clippedSamples": 0,
                "decodedSamplesPerChannel": 96_000,
                "audioIsSilent": False,
                "avDriftSeconds": 0.0,
                "avDriftFrames": 0.0,
                "measurementSource": "delivery-full-decode:ffmpeg-ebur128+astats;timeline:ffprobe-streams",
            },
            "progressPath": str(output_root / "render-progress.jsonl"),
            "outputManifestPath": str(output_root / "render-output.json"),
        }
        (output_root / "render-output.json").write_text(
            canonical(output) + "\n", encoding="utf-8"
        )
        return CommandResult(0, canonical(output), "")


def render_request(first_hash: str, second_hash: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "generationId": "36b271ef-6ce6-4809-b866-615cb9fe50b5",
        "timebase": 240_000,
        "seed": 17,
        "targets": [{"name": "youtube", "width": 320, "height": 180, "fps": 30}],
        "scenes": [
            {
                "id": "scene_intro",
                "sectionId": "section-1",
                "type": "worked_example",
                "title": "Split the input",
                "narration": "Split each number into two halves. Keep their place values.",
                "visualIntent": "Show a precise split diagram.",
                "durationTicks": 240_000,
                "accessibilityDescription": "Two numbers split into high and low halves.",
            },
            {
                "id": "scene_close",
                "type": "unsupported_old_kind",
                "title": "Recombine",
                "narration": "Add the shifted partial products.",
                "visualIntent": "Show three products recombining.",
                "durationTicks": 240_000,
            },
        ],
        "narration": [
            {
                "sceneId": "scene_intro",
                "artifactHash": first_hash,
                "mediaType": "audio/wav",
                "durationMs": 900,
            },
            {
                "sceneId": "scene_close",
                "artifactHash": second_hash,
                "mediaType": "audio/wav",
                "durationMs": 1_500,
            },
        ],
        "captions": {
            "captionsEnabled": True,
            "byScene": {
                "scene_intro": [
                    {
                        "cue_id": "intro-cue",
                        "start_ms": 100,
                        "end_ms": 900,
                        "text": "Split each number into two halves.",
                        "speaker": "Narrator",
                    }
                ],
                "scene_close": [
                    {
                        "cue_id": "close-cue",
                        "start_ms": 0,
                        "end_ms": 2_000,
                        "text": "Add the shifted partial products.",
                    }
                ],
            },
        },
    }


def test_subprocess_renderer_translates_materializes_invokes_and_cleans(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        client = SubprocessRendererClient(
            store,
            pins,
            options=RendererOptions(timeout_seconds=42, concurrency=1, chunk_frames=24),
            runner=runner,
        )

        rendered = client.render(render_request(first.hash, second.hash))

        assert rendered.content == b"deterministic-delivery"
        assert rendered.media_type == "video/webm"
        assert rendered.original_name == "tutorial.webm"
        assert rendered.metrics["frameCount"] == 60
        assert rendered.metrics["audioSampleRateHz"] == 48_000
        assert rendered.manifest["browser"]["networkPolicy"] == "deny"
        assert rendered.manifest["files"][0]["path"] == "tutorial.webm"
        assert "/attempt-" not in canonical(rendered.manifest)

        assert runner.render_manifest is not None
        manifest = runner.render_manifest
        assert manifest["target"]["name"] == "landscape"
        assert [scene["kind"] for scene in manifest["scenes"]] == [
            "worked-example",
            "bullets",
        ]
        assert manifest["scenes"][0]["content"]["title"] == "Split the input"
        assert manifest["scenes"][0]["captions"][0] == {
            "id": "intro-cue-0000",
            "startTick": 24_000,
            "endTick": 216_000,
            "text": "Split each number into two halves.",
            "speaker": "Narrator",
            "position": "bottom",
        }
        assert manifest["scenes"][1]["captions"][0]["endTick"] == 240_000
        assert manifest["audioInputs"][0]["startTick"] == 0
        assert manifest["audioInputs"][0]["endTick"] == 216_000
        assert manifest["audioInputs"][1]["startTick"] == 240_000
        assert manifest["audioInputs"][1]["endTick"] == 480_000
        render_call = runner.calls[-1]
        assert render_call[0][2] == "render"
        assert render_call[2] == 42
        assert runner.attempt_root is not None and not runner.attempt_root.exists()
    finally:
        store.close()


def test_subprocess_renderer_materializes_hash_bound_visual_for_image_and_presenter_scenes(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Visual Tutorial", name="Visual Tutorial")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        image = store.add_artifact_bytes(
            ONE_PIXEL_PNG,
            media_type="image/png",
            original_name="owned-background.png",
        )
        request = render_request(first.hash, second.hash)
        request["scenes"][0]["type"] = "image_focus"
        request["scenes"][1]["type"] = "presenter"
        request["assets"] = [
            {
                "sceneId": "scene_intro",
                "artifactHash": image.hash,
                "mediaType": "image/png",
                "assetId": "uploaded-explanation",
                "role": "primary",
                "fit": "contain",
                "alt": "An owned visual explanation",
            },
            {
                "sceneId": "scene_close",
                "artifactHash": image.hash,
                "mediaType": "image/png",
                "assetId": "uploaded-presenter",
                "role": "presenter-portrait",
                "fit": "cover",
                "alt": "The selected tutorial presenter",
            },
        ]
        client = SubprocessRendererClient(store, pins, runner=runner)
        client.render(request)
        assert runner.render_manifest is not None
        visual_inputs = runner.render_manifest["visualAssets"]
        assert [item["id"] for item in visual_inputs] == [
            "uploaded-explanation",
            "uploaded-presenter",
        ]
        assert all(item["sha256"] == image.hash for item in visual_inputs)
        assert all(item["mediaType"] == "image/png" for item in visual_inputs)
        scenes = runner.render_manifest["scenes"]
        assert scenes[0]["visualAssets"] == [
            {
                "assetId": "uploaded-explanation",
                "sha256": image.hash,
                "role": "primary",
                "alt": "An owned visual explanation",
                "fit": "contain",
            }
        ]
        assert scenes[1]["visualAssets"][0]["role"] == "presenter-portrait"
        assert not Path(visual_inputs[0]["path"]).exists(), "attempt staging must be cleaned"
    finally:
        store.close()


def test_subprocess_renderer_materializes_inspected_selected_font_and_typography(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Font Tutorial", name="Font Tutorial")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        font = store.add_artifact_bytes(
            b"\x00\x01\x00\x00owned-render-font", media_type="font/ttf"
        )
        family = f"AlystriaImported-{font.hash[:16]}"
        request = render_request(first.hash, second.hash)
        request["fontCustomization"] = {
            "fontAssets": [
                {
                    "id": "asset_owned_font",
                    "artifactHash": font.hash,
                    "mediaType": "font/ttf",
                    "family": family,
                    "roles": ["display", "body", "caption"],
                    "weight": 650,
                    "style": "normal",
                    "inspectionStatus": "metadata-inspected",
                    "embeddingPermission": "installable",
                    "exportEligible": True,
                }
            ],
            "typography": {
                "displayFamily": family,
                "bodyFamily": family,
                "codeFamily": "JetBrains Mono",
                "captionFamily": family,
            },
        }
        client = SubprocessRendererClient(store, pins, runner=runner)
        client.render(request)
        assert runner.render_manifest is not None
        manifest = runner.render_manifest
        assert manifest["typography"]["displayFamily"] == family
        assert manifest["captionStyle"]["fontFamily"] == family
        assert manifest["fontAssets"][0]["sha256"] == font.hash
        assert manifest["fontAssets"][0]["roles"] == ["display", "body", "caption"]
        assert not Path(manifest["fontAssets"][0]["path"]).exists()
    finally:
        store.close()


def test_renderer_stages_selected_music_and_sfx_as_hash_bound_program_audio(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Audio Tutorial", name="Audio Tutorial")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        music = store.add_artifact_bytes(
            b"RIFF-music", media_type="audio/wav", original_name="owned-bed.wav"
        )
        cue = store.add_artifact_bytes(
            b"fLaC-cue", media_type="audio/flac", original_name="owned-cue.flac"
        )
        request = render_request(first.hash, second.hash)
        request["audioCustomization"] = {
            "schemaVersion": 1,
            "mix": {"musicDuckingDb": -14.5},
            "inputs": [
                {
                    "assetId": "asset_music",
                    "artifactHash": music.hash,
                    "mediaType": "audio/wav",
                    "role": "music",
                    "source": "project",
                    "gainDb": -20.0,
                    "schedule": "full-program-loop",
                },
                {
                    "assetId": "asset_cue",
                    "artifactHash": cue.hash,
                    "mediaType": "audio/flac",
                    "role": "sfx",
                    "source": "project",
                    "gainDb": -12.0,
                    "schedule": "scene-emphasis",
                },
            ],
        }

        SubprocessRendererClient(store, pins, runner=runner).render(request)

        assert runner.render_manifest is not None
        program = [
            item
            for item in runner.render_manifest["audioInputs"]
            if item["role"] in {"music", "sfx"}
        ]
        assert len(program) == 2
        assert program[0] == {
            "id": "music-0000-asset_music",
            "assetId": "asset_music",
            "path": program[0]["path"],
            "sha256": music.hash,
            "mediaType": "audio/wav",
            "role": "music",
            "startTick": 0,
            "endTick": 480_000,
            "gainDb": -20.0,
            "loop": True,
            "duckingDb": -14.5,
        }
        assert program[1]["assetId"] == "asset_cue"
        assert program[1]["sha256"] == cue.hash
        assert program[1]["mediaType"] == "audio/flac"
        assert program[1]["role"] == "sfx"
        assert program[1]["startTick"] == 0
        assert not Path(program[0]["path"]).exists()
        assert not Path(program[1]["path"]).exists()
    finally:
        store.close()


def test_renderer_expands_custom_background_presenter_and_caption_style_without_paths(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Customized Tutorial", name="Customized Tutorial")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        background = store.add_artifact_bytes(ONE_PIXEL_PNG, media_type="image/png")
        portrait = store.add_artifact_bytes(ONE_PIXEL_PNG + b"portrait", media_type="image/png")
        request = render_request(first.hash, second.hash)
        request["scenes"][0]["type"] = "presenter-slide"
        request["scenes"][0]["presenterName"] = "Minji"
        request["scenes"][0]["presenterPlacement"] = "right"
        request["visualCustomization"] = {
            "schemaVersion": 1,
            "assets": [
                {
                    "assetId": "background.modern-tech-signal-v1",
                    "artifactHash": background.hash,
                    "mediaType": "image/png",
                    "role": "background",
                    "source": "starter",
                    "alt": "A quiet technical signal field",
                    "fit": "cover",
                },
                {
                    "assetId": "presenter-portrait.modern-tech-minji-v1",
                    "artifactHash": portrait.hash,
                    "mediaType": "image/png",
                    "role": "presenter-portrait",
                    "source": "starter",
                    "alt": "Fictional synthetic systems guide",
                    "fit": "contain",
                },
            ],
            "presenter": {"enabled": True, "placement": "right", "fit": "contain"},
            "captionStyle": {
                "position": "top",
                "style": "solid-panel",
                "sizePercent": 112,
                "safeInsetPercent": 9,
                "maxLines": 3,
                "textColor": "#FFF4D6",
                "panelColor": "#102033",
                "fontFamily": "Atkinson Hyperlegible Next",
                "fallbackFamilies": ["Arial", "sans-serif"],
            },
            "warnings": [],
        }

        SubprocessRendererClient(store, pins, runner=runner).render(request)
        assert runner.render_manifest is not None
        manifest = runner.render_manifest
        assert manifest["captionStyle"]["position"] == "top"
        assert manifest["captionStyle"]["maxLines"] == 3
        assert manifest["scenes"][0]["metadata"]["presenterName"] == "Minji"
        assert manifest["scenes"][0]["metadata"]["presenterPlacement"] == "right"
        assert [item["id"] for item in manifest["visualAssets"]] == [
            "background-modern-tech-signal-v1",
            "presenter-portrait-modern-tech-minji-v1",
        ]
        assert [item["role"] for item in manifest["scenes"][0]["visualAssets"]] == [
            "background",
            "presenter-portrait",
        ]
        assert [item["role"] for item in manifest["scenes"][1]["visualAssets"]] == [
            "background"
        ]
        assert not {"path", "url", "uri", "contentBase64"} & request["visualCustomization"]["assets"][0].keys()
    finally:
        store.close()


def test_subprocess_renderer_rejects_visual_media_type_mismatch(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Visual Tutorial", name="Visual Tutorial")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        image = store.add_artifact_bytes(ONE_PIXEL_PNG, media_type="image/png")
        request = render_request(first.hash, second.hash)
        request["assets"] = [
            {
                "sceneId": "scene_intro",
                "artifactHash": image.hash,
                "mediaType": "image/jpeg",
            }
        ]
        client = SubprocessRendererClient(store, pins, runner=runner)
        with pytest.raises(RendererOutputError, match="media type does not match"):
            client.render(request)
        assert runner.render_manifest is None
    finally:
        store.close()


def test_renderer_rejects_output_path_escape_and_cleans(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins, output_mode="escape")
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        client = SubprocessRendererClient(store, pins, runner=runner)
        with pytest.raises(RendererOutputError, match="escapes guarded root"):
            client.render(render_request(first.hash, second.hash))
        assert runner.attempt_root is not None and not runner.attempt_root.exists()
    finally:
        store.close()


def test_renderer_stages_real_presenter_video_only_for_presenter_scene(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        presenter = store.add_artifact_bytes(
            b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + bytes(128),
            media_type="video/mp4",
            original_name="synthetic-presenter.mp4",
            metadata={"rightsStatus": "owned"},
        )
        request = render_request(first.hash, second.hash)
        request["scenes"][0]["type"] = "presenter-slide"
        request["presenters"] = [
            {
                "sceneId": "scene_intro",
                "artifactHash": presenter.hash,
                "direction": {"placement": "picture_in_picture"},
            }
        ]
        rendered = SubprocessRendererClient(store, pins, runner=runner).render(request)

        assert rendered.content == b"deterministic-delivery"
        assert runner.render_manifest is not None
        videos = runner.render_manifest["presenterVideos"]
        assert videos == [
            {
                "id": "presenter-0000-scene_intro",
                "path": videos[0]["path"],
                "sha256": presenter.hash,
                "sceneId": "scene_intro",
                "placement": "picture-in-picture",
                "fit": "cover",
            }
        ]
        assert not Path(videos[0]["path"]).exists()
    finally:
        store.close()


def test_renderer_skips_explicit_nonvideo_presenter_placeholder(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        placeholder = store.add_artifact_bytes(
            b'{"synthetic":true}',
            media_type="application/vnd.alystria.presenter+json",
            original_name="fixture-presenter.json",
            metadata={"rightsStatus": "owned"},
        )
        request = render_request(first.hash, second.hash)
        request["scenes"][0]["type"] = "presenter-slide"
        request["presenters"] = [
            {"sceneId": "scene_intro", "artifactHash": placeholder.hash}
        ]
        SubprocessRendererClient(store, pins, runner=runner).render(request)
        assert runner.render_manifest is not None
        assert "presenterVideos" not in runner.render_manifest
    finally:
        store.close()


def test_renderer_detects_runtime_replacement_and_pre_start_cancel(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    pins = runtime_pins(tmp_path)
    runner = FakeRendererRunner(pins)
    try:
        first = store.add_artifact_bytes(b"RIFF-first", media_type="audio/wav")
        second = store.add_artifact_bytes(b"RIFF-second", media_type="audio/wav")
        request = render_request(first.hash, second.hash)
        client = SubprocessRendererClient(store, pins, runner=runner)
        pins.ffmpeg.path.write_bytes(b"replaced")
        with pytest.raises(RendererRuntimeError, match="FFmpeg SHA-256"):
            client.render(request)

        pins = runtime_pins(tmp_path)
        client = SubprocessRendererClient(store, pins, runner=FakeRendererRunner(pins))
        client.cancel()
        with pytest.raises(RendererCancelledError, match="cancelled"):
            client.render(request)
    finally:
        store.close()


def test_process_runner_enforces_timeout_without_a_shell(tmp_path: Path) -> None:
    runner = SubprocessCommandRunner()
    started = time.monotonic()
    with pytest.raises(RendererTimeoutError, match="timeout"):
        runner.run(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            cwd=tmp_path,
            timeout_seconds=0.05,
            cancelled=lambda: False,
        )
    assert time.monotonic() - started < 3


def installed_pack(root: Path) -> tuple[Path, dict[str, Path]]:
    paths: dict[str, Path] = {}
    components: list[dict[str, object]] = []
    versions = {
        "pipeline-worker": "2.0.0-rc.0",
        "node": "24.20.0",
        "renderer-cli": "2.0.0-rc.0",
        "chromium": "151.0.7922.34",
        "ffmpeg": "9.0.1",
        "ffprobe": "9.0.1",
    }
    for component_id, version in versions.items():
        path = root / "components" / component_id
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"installed-{component_id}".encode())
        paths[component_id] = path.resolve()
        components.append(
            {
                "id": component_id,
                "version": version,
                "target": "any",
                "relativePath": path.relative_to(root).as_posix(),
                "url": f"https://runtime.invalid/{component_id}",
                "sha256": digest(path),
                "sizeBytes": path.stat().st_size,
                "license": "MIT",
                "optional": False,
            }
        )
    manifest = {
        "schemaVersion": 1,
        "channel": "test",
        "generatedAt": "2026-08-28T00:00:00Z",
        "components": components,
        "signature": {
            "algorithm": "Ed25519",
            "keyId": "verified-by-rust-broker",
            "value": "not-revalidated-in-unprivileged-worker",
        },
        "note": "Python rechecks every component hash after Rust signature verification.",
    }
    manifest_path = root / "runtime-manifest.json"
    manifest_path.write_text(canonical(manifest), encoding="utf-8")
    return manifest_path, paths


def test_installed_pack_factory_needs_no_repository_or_package_json(tmp_path: Path) -> None:
    pack_root = tmp_path / "pack"
    pack_root.mkdir()
    manifest_path, paths = installed_pack(pack_root)
    store = ProjectStore.create(tmp_path / "project", name="Installed runtime")
    try:
        client = create_production_renderer_client(
            store,
            runtime_pack_root=pack_root,
            runtime_manifest_path=manifest_path,
        )
        assert client.runtime.node.path == paths["node"]
        assert client.runtime.renderer_cli_path == paths["renderer-cli"]
        assert client.runtime.chromium.version == "151.0.7922.34"
        assert client.runtime.renderer_version == "2.0.0-rc.0"
        assert not (pack_root / "package.json").exists()
    finally:
        store.close()


def test_installed_pack_factory_rejects_component_replacement(tmp_path: Path) -> None:
    pack_root = tmp_path / "pack"
    pack_root.mkdir()
    manifest_path, paths = installed_pack(pack_root)
    paths["renderer-cli"].write_bytes(b"replaced-after-verification")
    store = ProjectStore.create(tmp_path / "project", name="Corrupt runtime")
    try:
        with pytest.raises(RendererRuntimeError, match="renderer CLI"):
            create_production_renderer_client(
                store,
                runtime_pack_root=pack_root,
                runtime_manifest_path=manifest_path,
            )
    finally:
        store.close()


def test_production_mode_blocks_instead_of_falling_back_to_fixture(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ALYSTRIA_RENDERER_MODE", "production")
    for variable in (
        "ALYSTRIA_RUNTIME_PACK_ROOT",
        "ALYSTRIA_RUNTIME_MANIFEST_PATH",
        "ALYSTRIA_NODE_PATH",
        "ALYSTRIA_RENDERER_CLI_PATH",
        "ALYSTRIA_CHROMIUM_PATH",
        "ALYSTRIA_FFMPEG_PATH",
        "ALYSTRIA_FFPROBE_PATH",
    ):
        monkeypatch.delenv(variable, raising=False)
    store = ProjectStore.create(tmp_path / "project", name="Missing runtime")
    try:
        with pytest.raises(RendererRuntimeError, match="incomplete"):
            _production_renderer_client(store)
    finally:
        store.close()
