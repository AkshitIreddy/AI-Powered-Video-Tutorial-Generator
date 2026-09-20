from __future__ import annotations

import array
import copy
import hashlib
import json
import math
import shutil
import struct
import subprocess
import wave
from collections.abc import Sequence
from pathlib import Path
from types import SimpleNamespace

import pytest

import alystria.editor_export as editor_export_module
from alystria.editor_export import (
    EditorExportError,
    SubprocessEditorMediaProbe,
    build_editor_export_plan,
    render_editor_timeline,
)
from alystria.project import ProjectStore


class FakeCas:
    def __init__(self, root: Path, digest: str) -> None:
        self.root = root
        self.digest = digest
        self.source = root / "objects" / digest
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"trusted media")

    def verify(self, digest: str) -> bool:
        return digest == self.digest and self.source.is_file()

    def object_path(self, digest: str) -> Path:
        assert self.verify(digest)
        return self.source

    def add_file(self, path: Path, **_: object) -> SimpleNamespace:
        return SimpleNamespace(hash=hashlib.sha256(path.read_bytes()).hexdigest())


class FakeRunner:
    def __init__(self) -> None:
        self.argv: tuple[str, ...] = ()

    def run(self, argv: Sequence[str], *, timeout_seconds: float) -> None:
        assert 0 < timeout_seconds <= 3600
        self.argv = tuple(argv)
        Path(argv[-1]).write_bytes(b"rendered timeline")


class FakeMediaProbe:
    def __init__(self, has_audio: bool = True) -> None:
        self.has_audio = has_audio
        self.calls: list[tuple[Path, Path, float]] = []

    def has_audio_stream(self, source_path: Path, *, ffprobe_path: Path, timeout_seconds: float) -> bool:
        self.calls.append((source_path, ffprobe_path, timeout_seconds))
        return self.has_audio


def test_ffprobe_audio_inspection_is_hidden_and_shell_free_on_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    observed: dict[str, object] = {}

    def fake_run(argv: Sequence[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        observed.update(kwargs)
        return subprocess.CompletedProcess(argv, 0, b'{"streams":[{"index":1}]}', b"")

    monkeypatch.setattr(editor_export_module.os, "name", "nt")
    monkeypatch.setattr(editor_export_module.subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    monkeypatch.setattr(editor_export_module.subprocess, "run", fake_run)

    assert SubprocessEditorMediaProbe().has_audio_stream(
        Path("verified-source.webm"),
        ffprobe_path=Path("verified-ffprobe.exe"),
        timeout_seconds=10,
    )
    assert observed["creationflags"] == 0x08000000
    assert observed["shell"] is False
    assert observed["stdin"] is subprocess.DEVNULL


def manifest(digest: str) -> dict[str, object]:
    transform = {"x": 12, "y": -8, "scaleX": 0.75, "scaleY": 0.75, "rotation": 3, "anchorX": 0.5, "anchorY": 0.5}
    text_transform = {"x": 12, "y": -8, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0.5, "anchorY": 0.5}
    audio = {"volumeDb": -6, "pan": 0, "muted": False, "fadeInTicks": 24_000, "fadeOutTicks": 24_000}
    return {
        "schema": "alystria.editor.render.v1",
        "projectId": "project-editor",
        "name": "Rendered edit",
        "timebaseHz": 240_000,
        "frameRate": {"numerator": 30, "denominator": 1},
        "canvas": {"width": 1280, "height": 720, "pixelAspectRatio": 1, "backgroundColor": "#101116"},
        "durationTicks": 480_000,
        "codec": {"name": "vp9", "quality": 24},
        "assets": [
            {"id": "media", "artifactHash": digest, "mediaType": "video/webm", "kind": "video", "exportEligible": True},
            {"id": "voice", "artifactHash": digest, "mediaType": "audio/wav", "kind": "audio", "exportEligible": True},
        ],
        "clips": [
            {
                "id": "visual", "trackId": "track-slides", "kind": "slides", "layer": 0, "assetId": "media",
                "timelineStartTicks": 0, "timelineDurationTicks": 240_000, "sourceStartTicks": 120_000,
                "sourceDurationTicks": 480_000, "playbackRate": 2, "transform": transform, "opacity": 0.8,
                "audio": audio, "keyframes": [
                    {"property": "transform.x", "timelineTicks": 0, "value": -40, "interpolation": "linear"},
                    {"property": "transform.x", "timelineTicks": 120_000, "value": 40, "interpolation": "ease-in-out"},
                    {"property": "opacity", "timelineTicks": 0, "value": 0.2, "interpolation": "linear"},
                    {"property": "opacity", "timelineTicks": 120_000, "value": 1, "interpolation": "linear"},
                ],
                "includeSourceAudio": True,
            },
            {
                "id": "title", "trackId": "track-titles", "kind": "titles", "layer": 2, "assetId": None,
                "timelineStartTicks": 24_000, "timelineDurationTicks": 120_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 120_000, "playbackRate": 1, "transform": text_transform, "opacity": 1,
                "audio": audio, "text": "A title; with filter syntax", "keyframes": [],
                "textStyle": {"fontFamily": "Atkinson", "fontSize": 48, "fontWeight": 700, "color": "#FFFFFF", "backgroundColor": "#000000", "align": "center", "position": "top"},
            },
            {
                "id": "voice", "trackId": "track-narration", "kind": "narration", "layer": 4, "assetId": "voice",
                "timelineStartTicks": 48_000, "timelineDurationTicks": 240_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 240_000, "playbackRate": 1, "transform": transform, "opacity": 1,
                "audio": audio, "keyframes": [],
            },
            {
                "id": "caption", "trackId": "track-captions", "kind": "captions", "layer": 3, "assetId": None,
                "timelineStartTicks": 48_000, "timelineDurationTicks": 192_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 192_000, "playbackRate": 1, "transform": text_transform, "opacity": 1,
                "audio": audio, "text": "Frame-accurate caption", "keyframes": [],
                "textStyle": {"fontFamily": "Atkinson", "fontSize": 36, "fontWeight": 600, "color": "#FFFFFF", "backgroundColor": "#000000", "align": "center", "position": "bottom"},
            },
        ],
    }


def test_compiles_cas_bound_trim_speed_transform_text_and_codec(tmp_path: Path) -> None:
    digest = "a" * 64
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest), register_artifacts=lambda _artifacts: None)
    output = tmp_path / "exports" / "editor" / "lesson.webm"
    output.parent.mkdir(parents=True)
    staging = tmp_path / "staging" / "manual"
    probe = FakeMediaProbe()
    value = manifest(digest)
    value["clips"][3]["text"] = "First\r\nSecond\rThird\nFourth"
    plan = build_editor_export_plan(store, value, ffmpeg_path=Path("ffmpeg.exe"), media_probe=probe, output_path=output, staging_dir=staging)
    command = " ".join((*plan.audio_argv, *plan.argv))
    assert "[0:a]" not in plan.argv[plan.argv.index("-filter_complex") + 1]
    assert "[0:v]" not in plan.audio_argv[plan.audio_argv.index("-filter_complex") + 1]
    assert "trim=start=0.5:duration=2" in command
    assert "setpts=(PTS-STARTPTS)/2.000000000" in command
    assert "min(1280/iw,720/ih)" in command
    assert "ow='ceil(hypot(iw,ih)/2)*2'" in command
    assert "rotw(iw)" not in command
    assert "overlay=x='(W-w)/2+(" in command
    assert "drawtext=fontfile=" in command
    assert "expansion=none:text_align=T+C" in command
    assert "fontfile=" in command
    assert "[0:a]atrim=start=0.5:duration=2" in command
    assert "geq=" in command
    assert "eval=frame" in command
    assert "volume='pow(10," in command
    assert "afade=t=in:st=0:d=0.1" in command
    assert "afade=t=out:st=0.9:d=0.1" in command
    assert "-c:v libvpx-vp9" in command
    assert "-c:a libopus -b:a 192k" in command
    assert plan.media_type == "video/webm"
    assert plan.warnings
    assert probe.calls == [(store.cas.source, Path("ffprobe.exe"), 30)]
    assert (staging / "text-0000.txt").read_text(encoding="utf-8") == "A title; with filter syntax"
    assert (staging / "text-0001.txt").read_bytes() == b"First\nSecond\nThird\nFourth"


def test_music_loops_to_timeline_and_ducks_during_narration(tmp_path: Path) -> None:
    digest = "9" * 64
    store = SimpleNamespace(
        root=tmp_path,
        manifest=SimpleNamespace(project_id="project-editor"),
        cas=FakeCas(tmp_path, digest),
    )
    value = manifest(digest)
    value["assets"].append(  # type: ignore[union-attr]
        {
            "id": "music",
            "artifactHash": digest,
            "mediaType": "audio/wav",
            "kind": "audio",
            "exportEligible": True,
        }
    )
    value["clips"].append(  # type: ignore[union-attr]
        {
            "id": "music",
            "trackId": "track-music",
            "kind": "music",
            "layer": 5,
            "assetId": "music",
            "timelineStartTicks": 0,
            "timelineDurationTicks": 480_000,
            "sourceStartTicks": 0,
            "sourceDurationTicks": 480_000,
            "playbackRate": 1,
            "transform": {
                "x": 0,
                "y": 0,
                "scaleX": 1,
                "scaleY": 1,
                "rotation": 0,
                "anchorX": 0.5,
                "anchorY": 0.5,
            },
            "opacity": 1,
            "audio": {
                "volumeDb": -18.42,
                "pan": 0,
                "muted": False,
                "fadeInTicks": 0,
                "fadeOutTicks": 0,
            },
            "keyframes": [],
            "loop": True,
            "duckingDb": -12.96,
        }
    )
    plan = build_editor_export_plan(
        store,
        value,
        ffmpeg_path=Path("ffmpeg.exe"),
        media_probe=FakeMediaProbe(),
        output_path=tmp_path / "music.webm",
        staging_dir=tmp_path / "staging-music",
    )

    command = " ".join(plan.audio_argv)
    assert "-stream_loop -1" in command
    assert "volume='pow(10,(-18.420000000)/20)'" in command
    assert "between(t+0,0.2,1.2)" in command
    assert "pow(10,-12.960000000/20)" in command


def test_rejects_loop_or_ducking_on_non_music_audio(tmp_path: Path) -> None:
    digest = "8" * 64
    store = SimpleNamespace(
        root=tmp_path,
        manifest=SimpleNamespace(project_id="project-editor"),
        cas=FakeCas(tmp_path, digest),
    )
    value = manifest(digest)
    narration = value["clips"][2]  # type: ignore[index]
    narration["loop"] = True  # type: ignore[index]
    narration["duckingDb"] = -8  # type: ignore[index]

    with pytest.raises(EditorExportError, match="loop only on the music track"):
        build_editor_export_plan(
            store,
            value,
            ffmpeg_path=Path("ffmpeg.exe"),
            media_probe=FakeMediaProbe(),
            output_path=tmp_path / "invalid.webm",
            staging_dir=tmp_path / "staging-invalid",
        )


@pytest.mark.skipif(
    not Path(r"C:\FFmpeg\bin\ffmpeg.exe").is_file() and shutil.which("ffmpeg") is None,
    reason="FFmpeg is required for music loop and ducking proof",
)
def test_actual_music_loop_and_narration_ducking_reach_delivery(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None

    def wav_bytes(*, tone: bool) -> bytes:
        path = tmp_path / ("tone.wav" if tone else "silence.wav")
        with wave.open(str(path), "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(48_000)
            values = (
                int(6_000 * math.sin(2 * math.pi * 220 * index / 48_000)) if tone else 0
                for index in range(48_000)
            )
            writer.writeframes(b"".join(struct.pack("<h", value) for value in values))
        return path.read_bytes()

    with ProjectStore.create(tmp_path / "music-proof", name="Music proof") as store:
        music = store.add_artifact_bytes(tone_wav := wav_bytes(tone=True), media_type="audio/wav")
        narration = store.add_artifact_bytes(wav_bytes(tone=False), media_type="audio/wav")
        assert len(tone_wav) > 48_000
        ticks = 240_000
        transform = {
            "x": 0,
            "y": 0,
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "anchorX": 0.5,
            "anchorY": 0.5,
        }
        audio = {
            "volumeDb": -6,
            "pan": 0,
            "muted": False,
            "fadeInTicks": 0,
            "fadeOutTicks": 0,
        }
        value = {
            "schema": "alystria.editor.render.v1",
            "projectId": store.manifest.project_id,
            "name": "Music proof",
            "timebaseHz": ticks,
            "frameRate": {"numerator": 10, "denominator": 1},
            "canvas": {
                "width": 100,
                "height": 100,
                "pixelAspectRatio": 1,
                "backgroundColor": "#202020",
            },
            "durationTicks": 4 * ticks,
            "codec": {"name": "vp9", "quality": 28},
            "assets": [
                {
                    "id": "music",
                    "artifactHash": music.hash,
                    "mediaType": "audio/wav",
                    "kind": "audio",
                    "exportEligible": True,
                },
                {
                    "id": "narration",
                    "artifactHash": narration.hash,
                    "mediaType": "audio/wav",
                    "kind": "audio",
                    "exportEligible": True,
                },
            ],
            "clips": [
                {
                    "id": "music",
                    "trackId": "music-track",
                    "kind": "music",
                    "layer": 1,
                    "assetId": "music",
                    "timelineStartTicks": 0,
                    "timelineDurationTicks": 4 * ticks,
                    "sourceStartTicks": 0,
                    "sourceDurationTicks": 4 * ticks,
                    "playbackRate": 1,
                    "transform": transform,
                    "opacity": 1,
                    "audio": audio,
                    "keyframes": [],
                    "loop": True,
                    "duckingDb": -12,
                },
                {
                    "id": "narration",
                    "trackId": "narration-track",
                    "kind": "narration",
                    "layer": 2,
                    "assetId": "narration",
                    "timelineStartTicks": ticks,
                    "timelineDurationTicks": ticks,
                    "sourceStartTicks": 0,
                    "sourceDurationTicks": ticks,
                    "playbackRate": 1,
                    "transform": transform,
                    "opacity": 1,
                    "audio": audio,
                    "keyframes": [],
                },
            ],
        }
        receipt = render_editor_timeline(store, value, ffmpeg_path=ffmpeg)
        decoded = subprocess.run(
            [
                str(ffmpeg),
                "-v",
                "error",
                "-i",
                str(receipt["outputPath"]),
                "-map",
                "0:a:0",
                "-ac",
                "1",
                "-ar",
                "48000",
                "-f",
                "f32le",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        ).stdout
        samples = array.array("f", decoded)

        def rms(start: float, end: float) -> float:
            window = samples[round(start * 48_000) : round(end * 48_000)]
            return math.sqrt(sum(value * value for value in window) / len(window))

        before = rms(0.2, 0.8)
        during = rms(1.2, 1.8)
        after = rms(2.2, 2.8)
        assert before > 0.05
        assert during < before * 0.32
        assert after == pytest.approx(before, rel=0.08)


def test_elides_neutral_rotation_and_opacity_pixel_filters(tmp_path: Path) -> None:
    digest = "f" * 64
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest))
    value = manifest(digest)
    visual = value["clips"][0]  # type: ignore[index]
    visual["transform"] = {  # type: ignore[index]
        "x": 0,
        "y": 0,
        "scaleX": 1,
        "scaleY": 1,
        "rotation": 0,
        "anchorX": 0.5,
        "anchorY": 0.5,
    }
    visual["opacity"] = 1  # type: ignore[index]
    visual["keyframes"] = []  # type: ignore[index]
    plan = build_editor_export_plan(
        store,
        value,
        ffmpeg_path=Path("ffmpeg.exe"),
        media_probe=FakeMediaProbe(),
        output_path=tmp_path / "neutral.webm",
        staging_dir=tmp_path / "neutral-staging",
    )
    command = " ".join(plan.argv)
    assert "min(1280/iw,720/ih)" in command
    assert "rotate=" not in command
    assert "geq=" not in command


def test_executes_without_shell_and_content_addresses_delivery(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(editor_export_module, "verify_editor_delivery", lambda *_args, **_kwargs: {"testDouble": True})
    digest = "b" * 64
    registered: list[SimpleNamespace] = []
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest), register_artifacts=lambda artifacts: registered.extend(artifacts))
    runner = FakeRunner()
    receipt = render_editor_timeline(store, manifest(digest), ffmpeg_path=Path("ffmpeg.exe"), media_probe=FakeMediaProbe(), runner=runner)
    assert runner.argv[:4] == ("ffmpeg.exe", "-hide_banner", "-nostdin", "-y")
    assert receipt["projectId"] == "project-editor"
    assert receipt["mediaType"] == "video/webm"
    assert receipt["byteSize"] == len(b"rendered timeline")
    assert Path(str(receipt["outputPath"])).is_file()
    assert len(str(receipt["artifactHash"])) == 64
    assert [item["format"] for item in receipt["captionSidecars"]] == ["vtt", "srt"]
    assert [item.hash for item in registered] == [receipt["artifactHash"], *(item["artifactHash"] for item in receipt["captionSidecars"])]
    assert "00:00:00.200 --> 00:00:01.000" in Path(receipt["captionSidecars"][0]["path"]).read_text(encoding="utf-8")
    assert "00:00:00,200 --> 00:00:01,000" in Path(receipt["captionSidecars"][1]["path"]).read_text(encoding="utf-8")


def test_export_emits_hash_bound_licensed_asset_credits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(editor_export_module, "verify_editor_delivery", lambda *_args, **_kwargs: {"testDouble": True})
    source_bytes = b"trusted media"
    digest = hashlib.sha256(source_bytes).hexdigest()
    project_id = "11111111-1111-4111-8111-111111111111"
    initial_snapshot = {
        "id": project_id,
        "title": "Credited edit",
        "scenes": [],
        "sources": [],
        "customization": {
            "assets": [
                {
                    "id": "voice",
                    "kind": "music",
                    "label": "Curious Motion",
                    "source": "licensed-media",
                    "sha256": digest,
                    "creator": "Ada Artist",
                    "license": "CC-BY-4.0",
                    "attribution": (
                        '"Curious Motion" by Ada Artist · CC-BY-4.0 '
                        "(https://creativecommons.org/licenses/by/4.0/) · "
                        "https://source.test/curious-motion"
                    ),
                    "sourceUrl": "https://source.test/curious-motion",
                    "rightsStatus": "cleared",
                }
            ]
        },
    }
    with ProjectStore.create(
        tmp_path / "credited-project",
        name="Credited edit",
        project_id=project_id,
        initial_snapshot=initial_snapshot,
    ) as store:
        source = store.add_artifact_bytes(source_bytes, media_type="audio/wav")
        assert source.hash == digest
        value = manifest(digest)
        value["projectId"] = project_id
        receipt = render_editor_timeline(
            store,
            value,
            ffmpeg_path=Path("ffmpeg.exe"),
            media_probe=FakeMediaProbe(),
            runner=FakeRunner(),
        )

        assert receipt["attributions"] == [
            {
                "assetId": "voice",
                "title": "Curious Motion",
                "role": "music",
                "creator": "Ada Artist",
                "license": "CC-BY-4.0",
                "attribution": initial_snapshot["customization"]["assets"][0]["attribution"],  # type: ignore[index]
                "sourceUrl": "https://source.test/curious-motion",
                "sha256": digest,
            }
        ]
        sidecar = receipt["attributionSidecar"]
        assert sidecar is not None
        credits = json.loads(Path(sidecar["path"]).read_text(encoding="utf-8"))
        assert credits == {
            "schema": "alystria.editor.credits.v1",
            "projectId": project_id,
            "assets": receipt["attributions"],
        }
        row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash = ?",
            (receipt["artifactHash"],),
        ).fetchone()
        assert row is not None
        assert json.loads(str(row["metadata_json"]))["attributions"] == receipt["attributions"]


def test_cancellation_after_encode_prevents_artifact_promotion(tmp_path: Path) -> None:
    digest = "b" * 64
    registered: list[SimpleNamespace] = []
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest), register_artifacts=lambda artifacts: registered.extend(artifacts))
    runner = FakeRunner()
    with pytest.raises(EditorExportError, match="cancelled before promotion"):
        render_editor_timeline(
            store, manifest(digest), ffmpeg_path=Path("ffmpeg.exe"),
            media_probe=FakeMediaProbe(), runner=runner, cancel_check=lambda: True,
        )
    assert runner.argv
    assert not registered


def test_failed_delivery_verification_prevents_artifact_promotion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject(*_args: object, **_kwargs: object) -> None:
        raise EditorExportError("Editor delivery audio lasts 0.500s; expected 2.000s")

    monkeypatch.setattr(editor_export_module, "verify_editor_delivery", reject)
    digest = "b" * 64
    registered: list[SimpleNamespace] = []
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"),
                            cas=FakeCas(tmp_path, digest), register_artifacts=registered.extend)
    with pytest.raises(EditorExportError, match="audio lasts"):
        render_editor_timeline(store, manifest(digest), ffmpeg_path=Path("ffmpeg.exe"),
                               media_probe=FakeMediaProbe(), runner=FakeRunner())
    assert not registered
    assert not list((tmp_path / "exports" / "editor").iterdir())


def test_rejects_untrusted_or_unsupported_timeline_features(tmp_path: Path) -> None:
    digest = "c" * 64
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest))
    value = manifest(digest)
    value["assets"][0]["exportEligible"] = False  # type: ignore[index]
    with pytest.raises(EditorExportError, match="not eligible"):
        build_editor_export_plan(store, value, ffmpeg_path=Path("ffmpeg.exe"), media_probe=FakeMediaProbe(), output_path=tmp_path / "out.webm", staging_dir=tmp_path / "stage-1")

    value = manifest(digest)
    value["clips"][0]["keyframes"] = [{"property": "opacity", "timelineTicks": 999_999, "value": 0.5, "interpolation": "linear"}]  # type: ignore[index]
    with pytest.raises(EditorExportError, match="outside its timeline"):
        build_editor_export_plan(store, value, ffmpeg_path=Path("ffmpeg.exe"), media_probe=FakeMediaProbe(), output_path=tmp_path / "out.webm", staging_dir=tmp_path / "stage-2")


def test_requested_source_audio_is_omitted_when_verified_video_has_no_audio_stream(tmp_path: Path) -> None:
    digest = "d" * 64
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest))
    output = tmp_path / "exports" / "editor" / "silent.webm"
    output.parent.mkdir(parents=True)
    probe = FakeMediaProbe(has_audio=False)
    plan = build_editor_export_plan(
        store,
        manifest(digest),
        ffmpeg_path=Path("ffmpeg.exe"),
        ffprobe_path=Path("verified-ffprobe.exe"),
        media_probe=probe,
        output_path=output,
        staging_dir=tmp_path / "staging" / "silent",
    )
    command = " ".join(plan.argv)
    assert "[0:a]" not in command
    assert "[1:a]" in " ".join(plan.audio_argv)
    assert "visual requested source audio, but its verified video asset has no audio stream." in plan.warnings
    assert probe.calls == [(store.cas.source, Path("verified-ffprobe.exe"), 30)]


def _ffmpeg() -> Path | None:
    pinned = Path(r"C:\FFmpeg\bin\ffmpeg.exe")
    if pinned.is_file():
        return pinned
    found = shutil.which("ffmpeg")
    return None if found is None else Path(found)


def _actual_manifest(digest: str, project_id: str) -> dict[str, object]:
    transform = {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0.5, "anchorY": 0.5}
    audio = {"volumeDb": -3, "pan": 0, "muted": False, "fadeInTicks": 0, "fadeOutTicks": 0}
    text_style = {"fontFamily": "Atkinson", "fontSize": 10, "fontWeight": 700, "color": "#FFFFFF", "backgroundColor": None, "align": "center"}
    motion = []
    for prop, first, middle, last in (
        ("transform.x", -30, 0, 30),
        ("transform.scaleX", 0.75, 1, 0.75),
        ("transform.scaleY", 0.75, 1, 0.75),
        ("transform.rotation", -10, 0, 10),
        ("opacity", 0.35, 1, 0.35),
    ):
        motion.extend(
            [
                {"property": prop, "timelineTicks": 0, "value": first, "interpolation": "linear"},
                {"property": prop, "timelineTicks": 120_000, "value": middle, "interpolation": "ease-in-out"},
                {"property": prop, "timelineTicks": 239_999, "value": last, "interpolation": "linear"},
            ]
        )
    return {
        "schema": "alystria.editor.render.v1",
        "projectId": project_id,
        "name": "Native media proof",
        "timebaseHz": 240_000,
        "frameRate": {"numerator": 10, "denominator": 1},
        "canvas": {"width": 100, "height": 100, "pixelAspectRatio": 1, "backgroundColor": "#0000FF"},
        "durationTicks": 240_000,
        "codec": {"name": "vp9", "quality": 24},
        "assets": [{"id": "programme", "artifactHash": digest, "mediaType": "video/webm", "kind": "video", "exportEligible": True}],
        "clips": [
            {
                "id": "motion", "trackId": "slides", "kind": "slides", "layer": 0, "assetId": "programme",
                "timelineStartTicks": 0, "timelineDurationTicks": 240_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 240_000, "playbackRate": 1, "transform": transform, "opacity": 1,
                "audio": audio, "keyframes": motion, "includeSourceAudio": True,
            },
            {
                "id": "title", "trackId": "titles", "kind": "titles", "layer": 1, "assetId": None,
                "timelineStartTicks": 0, "timelineDurationTicks": 240_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 240_000, "playbackRate": 1, "transform": transform, "opacity": 1,
                "audio": audio, "keyframes": [
                    {"property": "transform.x", "timelineTicks": 0, "value": -5, "interpolation": "linear"},
                    {"property": "transform.x", "timelineTicks": 239_999, "value": 5, "interpolation": "linear"},
                ], "text": "TITLE 100%", "textStyle": {**text_style, "position": "top"},
            },
            {
                "id": "caption", "trackId": "captions", "kind": "captions", "layer": 2, "assetId": None,
                "timelineStartTicks": 0, "timelineDurationTicks": 240_000, "sourceStartTicks": 0,
                "sourceDurationTicks": 240_000, "playbackRate": 1, "transform": transform, "opacity": 1,
                "audio": audio, "keyframes": [
                    {"property": "opacity", "timelineTicks": 0, "value": 0.5, "interpolation": "linear"},
                    {"property": "opacity", "timelineTicks": 239_999, "value": 1, "interpolation": "linear"},
                ], "text": "CAPTION", "textStyle": {**text_style, "position": "bottom"},
            },
        ],
    }


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for delivery rejection proof")
@pytest.mark.parametrize(("audio_duration", "gain", "error"), [
    (0.3, 1, "audio lasts"), (1, 32, "audio clips"),
])
def test_actual_delivery_gate_rejects_short_or_clipping_audio(
    tmp_path: Path, audio_duration: float, gain: int, error: str,
) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    output = tmp_path / "bad-delivery.mkv"
    subprocess.run([
        str(ffmpeg), "-v", "error", "-f", "lavfi", "-i", "color=s=20x20:r=10:d=1",
        "-f", "lavfi", "-i", f"sine=duration={audio_duration}:sample_rate=48000",
        "-af", f"volume={gain}", "-c:v", "ffv1", "-c:a", "pcm_f32le", str(output),
    ], check=True, capture_output=True)
    with pytest.raises(EditorExportError, match=error):
        editor_export_module.verify_editor_delivery(
            output, ffmpeg_path=ffmpeg, duration_seconds=1, fps=10, timeout_seconds=10,
        )


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for audio placement proof")
@pytest.mark.parametrize("kind", ["slides", "narration"])
@pytest.mark.parametrize("sample_rate", [44100, 48000])
def test_actual_audio_preserves_delayed_source_trims_and_timeline_gaps(
    tmp_path: Path, kind: str, sample_rate: int,
) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    source_path = tmp_path / "source.mkv"
    subprocess.run([
        str(ffmpeg), "-v", "error", "-f", "lavfi", "-i", "color=s=20x20:r=1:d=6",
        "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate={sample_rate}:duration=6",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source_path),
    ], check=True, capture_output=True)
    with ProjectStore.create(tmp_path / "project", name="Audio placement") as store:
        source = store.add_artifact_bytes(source_path.read_bytes(), media_type="video/x-matroska")
        value = _actual_manifest(source.hash, store.manifest.project_id)
        value["durationTicks"] = 6 * 240_000
        if kind == "narration":
            value["assets"][0]["kind"] = "audio"
        clips = []
        for index, start in enumerate((0, 2, 4)):
            clip = copy.deepcopy(value["clips"][0])
            clip.update(id=f"clip-{index}", kind=kind, keyframes=[],
                        timelineStartTicks=start * 240_000, sourceStartTicks=start * 240_000)
            clips.append(clip)
        value["clips"] = clips
        plan = build_editor_export_plan(
            store, value, ffmpeg_path=ffmpeg, output_path=tmp_path / "unused.webm",
            staging_dir=tmp_path / "staging",
        )
        subprocess.run(plan.audio_argv, check=True, capture_output=True)
        decoded = subprocess.run([
            str(ffmpeg), "-v", "error", "-i", plan.audio_argv[-1],
            "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1",
        ], check=True, capture_output=True).stdout
        samples = array.array("f", decoded)
        assert len(samples) == 6 * 48000
        for second in range(6):
            window = samples[second * 48000 + 4800:second * 48000 + 43200]
            peak = max(map(abs, window))
            if second % 2 == 0:
                assert 0.08 < peak < 0.10, (second, peak)
            else:
                assert peak < 0.0001, (second, peak)


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for native editor media proof")
def test_actual_ffmpeg_renders_motion_text_captions_and_source_audio(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    source_path = tmp_path / "programme.webm"
    subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=20x20:r=10:d=1",
            "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=1",
            "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
            "-c:a", "libopus", "-shortest", str(source_path),
        ],
        check=True,
        capture_output=True,
    )
    with ProjectStore.create(tmp_path / "proof-project", name="Native media proof") as store:
        source = store.add_artifact_bytes(source_path.read_bytes(), media_type="video/webm", original_name=source_path.name)
        receipt = render_editor_timeline(store, _actual_manifest(source.hash, store.manifest.project_id), ffmpeg_path=ffmpeg)
        output_path = Path(str(receipt["outputPath"]))
        ffprobe = ffmpeg.with_name("ffprobe.exe" if ffmpeg.suffix.lower() == ".exe" else "ffprobe")
        probe = subprocess.run(
            [str(ffprobe), "-v", "error", "-show_entries", "stream=codec_type,codec_name,color_space,color_transfer,color_primaries,color_range", "-of", "json", str(output_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        streams = json.loads(probe.stdout)["streams"]
        assert {stream["codec_type"] for stream in streams} == {"video", "audio"}
        assert next(stream["codec_name"] for stream in streams if stream["codec_type"] == "audio") == "opus"
        video_stream = next(stream for stream in streams if stream["codec_type"] == "video")
        assert video_stream["color_space"] == "bt709"
        assert video_stream["color_transfer"] == "iec61966-2-1"
        assert video_stream["color_primaries"] == "bt709"
        assert video_stream["color_range"] == "tv"

        raw = subprocess.run(
            [str(ffmpeg), "-v", "error", "-i", str(output_path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True,
            capture_output=True,
        ).stdout
        frame_size = 100 * 100 * 3
        assert len(raw) >= frame_size * 10

        def pixel(frame: int, x: int, y: int) -> tuple[int, int, int]:
            offset = frame * frame_size + (y * 100 + x) * 3
            return tuple(raw[offset:offset + 3])  # type: ignore[return-value]

        first_left = pixel(0, 20, 50)
        middle_centre = pixel(5, 50, 50)
        last_right = pixel(9, 80, 50)
        assert first_left[0] > 60 and first_left[2] > 100
        assert middle_centre[0] > 220 and middle_centre[2] < 30
        assert last_right[0] > 60 and last_right[2] > 100
        assert pixel(9, 20, 50)[2] > 200
        assert any(all(channel > 180 for channel in pixel(0, x, y)) for y in range(2, 20) for x in range(100))
        assert any(all(channel > 180 for channel in pixel(9, x, y)) for y in range(80, 98) for x in range(100))

        sidecars = receipt["captionSidecars"]
        assert [sidecar["format"] for sidecar in sidecars] == ["vtt", "srt"]
        assert "00:00:00.000 --> 00:00:01.000" in Path(sidecars[0]["path"]).read_text(encoding="utf-8")
        assert "CAPTION" in Path(sidecars[1]["path"]).read_text(encoding="utf-8")


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for native editor fit and rotation proof")
@pytest.mark.parametrize(("rotation", "scale"), [(0, 1), (30, 0.5)])
def test_actual_ffmpeg_contains_source_before_transform_without_cropping_edges(
    tmp_path: Path,
    rotation: int,
    scale: float,
) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    source_path = tmp_path / f"edge-source-{rotation}.webm"
    subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi", "-i", "color=c=white:s=960x540:r=10:d=1",
            "-vf",
            "drawbox=x=0:y=0:w=72:h=ih:color=red:t=fill,"
            "drawbox=x=iw-72:y=0:w=72:h=ih:color=lime:t=fill,"
            "drawbox=x=72:y=0:w=iw-144:h=54:color=blue:t=fill,"
            "drawbox=x=72:y=ih-54:w=iw-144:h=54:color=yellow:t=fill",
            "-an", "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuv420p", str(source_path),
        ],
        check=True,
        capture_output=True,
    )
    with ProjectStore.create(tmp_path / f"fit-proof-{rotation}", name="Editor fit proof") as store:
        source = store.add_artifact_bytes(source_path.read_bytes(), media_type="video/webm", original_name=source_path.name)
        value = _actual_manifest(source.hash, store.manifest.project_id)
        value["canvas"] = {"width": 1280, "height": 720, "pixelAspectRatio": 1, "backgroundColor": "#000000"}
        value["clips"] = [value["clips"][0]]  # type: ignore[index]
        clip = value["clips"][0]  # type: ignore[index]
        clip["transform"] = {  # type: ignore[index]
            "x": 0,
            "y": 0,
            "scaleX": scale,
            "scaleY": scale,
            "rotation": rotation,
            "anchorX": 0.5,
            "anchorY": 0.5,
        }
        clip["keyframes"] = []  # type: ignore[index]
        clip["includeSourceAudio"] = False  # type: ignore[index]
        receipt = render_editor_timeline(store, value, ffmpeg_path=ffmpeg)
        output_path = Path(str(receipt["outputPath"]))
        raw = subprocess.run(
            [str(ffmpeg), "-v", "error", "-ss", "0.5", "-i", str(output_path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True,
            capture_output=True,
        ).stdout
        assert len(raw) == 1280 * 720 * 3

        def pixels() -> list[tuple[int, int, int]]:
            return [tuple(raw[index:index + 3]) for index in range(0, len(raw), 3)]  # type: ignore[misc]

        decoded = pixels()
        assert any(red > 180 and green < 70 and blue < 70 for red, green, blue in decoded)
        assert any(red < 70 and green > 180 and blue < 70 for red, green, blue in decoded)
        assert any(red < 70 and green < 70 and blue > 180 for red, green, blue in decoded)
        assert any(red > 180 and green > 180 and blue < 70 for red, green, blue in decoded)

        def pixel(x: int, y: int) -> tuple[int, int, int]:
            offset = (y * 1280 + x) * 3
            return tuple(raw[offset:offset + 3])  # type: ignore[return-value]

        if rotation == 0:
            left = pixel(16, 360)
            right = pixel(1263, 360)
            top = pixel(640, 16)
            bottom = pixel(640, 703)
            assert left[0] > 180 and left[1] < 70 and left[2] < 70
            assert right[0] < 70 and right[1] > 180 and right[2] < 70
            assert top[0] < 70 and top[1] < 70 and top[2] > 180
            assert bottom[0] > 180 and bottom[1] > 180 and bottom[2] < 70
        else:
            left = pixel(363, 201)
            right = pixel(917, 521)
            top = pixel(730, 205)
            bottom = pixel(550, 517)
            assert left[0] > 180 and left[1] < 70 and left[2] < 70
            assert right[0] < 70 and right[1] > 180 and right[2] < 70
            assert top[0] < 70 and top[1] < 70 and top[2] > 180
            assert bottom[0] > 180 and bottom[1] > 180 and bottom[2] < 70


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for native editor alpha proof")
def test_actual_ffmpeg_neutral_filter_elision_preserves_source_alpha(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    source_path = tmp_path / "transparent-source.png"
    subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi", "-i",
            "color=c=black@0.0:s=100x100:d=1,format=rgba,"
            "drawbox=x=25:y=25:w=50:h=50:color=red@1.0:t=fill:replace=1",
            "-frames:v", "1", "-threads", "1", str(source_path),
        ],
        check=True,
        capture_output=True,
    )
    with ProjectStore.create(tmp_path / "alpha-proof", name="Editor alpha proof") as store:
        source = store.add_artifact_bytes(source_path.read_bytes(), media_type="image/png", original_name=source_path.name)
        value = _actual_manifest(source.hash, store.manifest.project_id)
        value["canvas"] = {"width": 200, "height": 200, "pixelAspectRatio": 1, "backgroundColor": "#0000FF"}
        value["assets"] = [{"id": "programme", "artifactHash": source.hash, "mediaType": "image/png", "kind": "image", "exportEligible": True}]
        value["clips"] = [value["clips"][0]]  # type: ignore[index]
        clip = value["clips"][0]  # type: ignore[index]
        clip["keyframes"] = []  # type: ignore[index]
        clip["includeSourceAudio"] = False  # type: ignore[index]
        receipt = render_editor_timeline(store, value, ffmpeg_path=ffmpeg)
        raw = subprocess.run(
            [str(ffmpeg), "-v", "error", "-i", str(receipt["outputPath"]), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True,
            capture_output=True,
        ).stdout
        assert len(raw) == 200 * 200 * 3

        def pixel(x: int, y: int) -> tuple[int, int, int]:
            offset = (y * 200 + x) * 3
            return tuple(raw[offset:offset + 3])  # type: ignore[return-value]

        corner = pixel(10, 10)
        centre = pixel(100, 100)
        assert corner[0] < 40 and corner[1] < 40 and corner[2] > 180
        assert centre[0] > 180 and centre[1] < 70 and centre[2] < 70


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for silent native editor media proof")
def test_actual_ffmpeg_renders_silent_video_when_source_audio_is_requested(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    source_path = tmp_path / "silent-programme.webm"
    subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-nostdin", "-y",
            "-f", "lavfi", "-i", "color=c=teal:s=20x20:r=10:d=1",
            "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", str(source_path),
        ],
        check=True,
        capture_output=True,
    )
    with ProjectStore.create(tmp_path / "silent-proof-project", name="Silent native media proof") as store:
        source = store.add_artifact_bytes(source_path.read_bytes(), media_type="video/webm", original_name=source_path.name)
        receipt = render_editor_timeline(store, _actual_manifest(source.hash, store.manifest.project_id), ffmpeg_path=ffmpeg)
        output_path = Path(str(receipt["outputPath"]))
        assert output_path.is_file() and output_path.stat().st_size > 0
        assert "motion requested source audio, but its verified video asset has no audio stream." in receipt["warnings"]
        decoded_audio = subprocess.run(
            [str(ffmpeg), "-v", "error", "-i", str(output_path), "-map", "0:a:0", "-f", "s16le", "-acodec", "pcm_s16le", "-"],
            check=True,
            capture_output=True,
        ).stdout
        assert decoded_audio
        assert not any(decoded_audio)
