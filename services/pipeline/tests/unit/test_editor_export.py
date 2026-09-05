from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
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
        assert timeout_seconds == 3600
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
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest))
    output = tmp_path / "exports" / "editor" / "lesson.webm"
    output.parent.mkdir(parents=True)
    staging = tmp_path / "staging" / "manual"
    probe = FakeMediaProbe()
    plan = build_editor_export_plan(store, manifest(digest), ffmpeg_path=Path("ffmpeg.exe"), media_probe=probe, output_path=output, staging_dir=staging)
    command = " ".join(plan.argv)
    assert "trim=start=0.5:duration=2" in command
    assert "setpts=(PTS-STARTPTS)/2.000000000" in command
    assert "overlay=x='(W-w)/2+(" in command
    assert "drawtext=fontfile=" in command
    assert "fontfile=" in command
    assert "[0:a]atrim=start=0.5:duration=2" in command
    assert "geq=" in command
    assert "eval=frame" in command
    assert "volume='pow(10," in command
    assert "afade=t=in:st=0:d=0.1" in command
    assert "afade=t=out:st=0.9:d=0.1" in command
    assert "-c:v libvpx-vp9" in command
    assert plan.media_type == "video/webm"
    assert plan.warnings
    assert probe.calls == [(store.cas.source, Path("ffprobe.exe"), 30)]
    assert (staging / "text-0000.txt").read_text(encoding="utf-8") == "A title; with filter syntax"


def test_executes_without_shell_and_content_addresses_delivery(tmp_path: Path) -> None:
    digest = "b" * 64
    store = SimpleNamespace(root=tmp_path, manifest=SimpleNamespace(project_id="project-editor"), cas=FakeCas(tmp_path, digest))
    runner = FakeRunner()
    receipt = render_editor_timeline(store, manifest(digest), ffmpeg_path=Path("ffmpeg.exe"), media_probe=FakeMediaProbe(), runner=runner)
    assert runner.argv[:4] == ("ffmpeg.exe", "-hide_banner", "-nostdin", "-y")
    assert receipt["projectId"] == "project-editor"
    assert receipt["mediaType"] == "video/webm"
    assert receipt["byteSize"] == len(b"rendered timeline")
    assert Path(str(receipt["outputPath"])).is_file()
    assert len(str(receipt["artifactHash"])) == 64
    assert [item["format"] for item in receipt["captionSidecars"]] == ["vtt", "srt"]
    assert "00:00:00.200 --> 00:00:01.000" in Path(receipt["captionSidecars"][0]["path"]).read_text(encoding="utf-8")
    assert "00:00:00,200 --> 00:00:01,000" in Path(receipt["captionSidecars"][1]["path"]).read_text(encoding="utf-8")


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
    assert "[1:a]" in command
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
                ], "text": "TITLE", "textStyle": {**text_style, "position": "top"},
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
            [str(ffprobe), "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", str(output_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        streams = json.loads(probe.stdout)["streams"]
        assert {stream["codec_type"] for stream in streams} == {"video", "audio"}
        assert next(stream["codec_name"] for stream in streams if stream["codec_type"] == "audio") == "opus"

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
