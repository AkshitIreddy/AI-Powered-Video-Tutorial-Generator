"""Guarded subprocess bridge to Alystria's deterministic Node renderer."""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from alystria.project import ProjectStore

from .adapters import RenderedTutorial

TICKS_PER_SECOND = 240_000
TICKS_PER_MILLISECOND = TICKS_PER_SECOND // 1_000
MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_OUTPUT_MANIFEST_BYTES = 16 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SAFE_NAME_PATTERN = re.compile(r"[^a-zA-Z0-9_-]+")
SUPPORTED_SCENE_KINDS = frozenset(
    {
        "title",
        "section-intro",
        "definition",
        "bullets",
        "comparison",
        "diagram",
        "timeline",
        "formula",
        "derivation",
        "graph",
        "code",
        "walkthrough",
        "diff",
        "file-tree",
        "terminal",
        "execution-trace",
        "variable-state",
        "chart",
        "table",
        "map",
        "image-focus",
        "image-comparison",
        "document-focus",
        "ui-demo",
        "screen-recording",
        "simulation",
        "presenter",
        "presenter-slide",
        "quote",
        "question",
        "worked-example",
        "quiz",
        "recap",
        "summary",
        "sources",
        "outro",
    }
)
SUPPORTED_CODECS = frozenset(
    {"vp9", "av1", "h264_nvenc", "h264_mf", "libx264", "hevc_nvenc"}
)
MEDIA_EXTENSIONS = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
}


class RendererClientError(RuntimeError):
    """Base class for actionable production renderer failures."""


class RendererRuntimeError(RendererClientError):
    """A pinned executable or renderer process failed validation."""


class RendererOutputError(RendererClientError):
    """The renderer returned missing, unsafe, or internally inconsistent output."""


class RendererCancelledError(RendererClientError):
    """Rendering was cancelled by the owning job."""


class RendererTimeoutError(RendererClientError):
    """Rendering exceeded its configured wall-clock bound."""


@dataclass(frozen=True, slots=True)
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str


class RendererCommandRunner(Protocol):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> CommandResult: ...


class SubprocessCommandRunner:
    """Run one exact argv vector without invoking a command shell."""

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        if not argv or any(not part or "\x00" in part for part in argv):
            raise RendererRuntimeError("Renderer argv contains an empty value or NUL byte")
        if timeout_seconds <= 0:
            raise ValueError("Renderer timeout must be positive")
        if cancelled():
            raise RendererCancelledError("Render cancelled before process start")
        creation_flags = 0
        popen_options: dict[str, Any] = {}
        if os.name == "nt":
            creation_flags = int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        else:
            popen_options["start_new_session"] = True
        try:
            process = subprocess.Popen(
                list(argv),
                cwd=cwd,
                env=os.environ.copy(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                creationflags=creation_flags,
                **popen_options,
            )
        except OSError as error:
            raise RendererRuntimeError(f"Could not start renderer process: {error}") from error

        started = time.monotonic()
        while True:
            elapsed = time.monotonic() - started
            if cancelled():
                self._stop(process)
                process.communicate()
                raise RendererCancelledError("Render cancelled")
            if elapsed >= timeout_seconds:
                self._stop(process)
                process.communicate()
                raise RendererTimeoutError(
                    f"Renderer exceeded the {timeout_seconds:g}-second timeout"
                )
            try:
                stdout, stderr = process.communicate(
                    timeout=min(0.2, max(0.01, timeout_seconds - elapsed))
                )
                return CommandResult(
                    process.returncode if process.returncode is not None else -1,
                    _bounded_decode(stdout),
                    _bounded_decode(stderr),
                )
            except subprocess.TimeoutExpired:
                continue

    @staticmethod
    def _stop(process: subprocess.Popen[bytes]) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt" and hasattr(signal, "CTRL_BREAK_EVENT"):
                process.send_signal(signal.CTRL_BREAK_EVENT)
            elif os.name != "nt":
                _kill_process_group(process.pid, signal.SIGTERM)
            else:
                process.terminate()
            process.wait(timeout=2)
        except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
            try:
                if os.name != "nt":
                    _kill_process_group(process.pid, int(getattr(signal, "SIGKILL", signal.SIGTERM)))
                else:
                    process.kill()
            except (OSError, ProcessLookupError):
                pass


@dataclass(frozen=True, slots=True)
class PinnedExecutable:
    """One exact runtime file plus the version it must report."""

    path: Path
    version: str
    sha256: str
    version_arguments: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.version.strip():
            raise ValueError("Pinned executable version cannot be blank")
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("Pinned executable SHA-256 must be 64 lowercase hex characters")
        if not self.version_arguments:
            raise ValueError("Pinned executable needs version-probe arguments")


@dataclass(frozen=True, slots=True)
class RendererRuntimePins:
    node: PinnedExecutable
    renderer_cli_path: Path
    renderer_cli_sha256: str
    chromium: PinnedExecutable
    ffmpeg: PinnedExecutable
    ffprobe: PinnedExecutable
    renderer_version: str

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.renderer_cli_sha256):
            raise ValueError("Renderer CLI SHA-256 must be 64 lowercase hex characters")
        if not self.renderer_version.strip():
            raise ValueError("Renderer version cannot be blank")


@dataclass(frozen=True, slots=True)
class RendererOptions:
    codec: str = "vp9"
    quality: int | None = None
    bitrate: str | None = None
    concurrency: int = 2
    chunk_frames: int = 120
    timeout_seconds: float = 3_600

    def __post_init__(self) -> None:
        if self.codec not in SUPPORTED_CODECS:
            raise ValueError(f"Unsupported renderer codec {self.codec!r}")
        if self.quality is not None and self.quality < 0:
            raise ValueError("Renderer quality cannot be negative")
        if not 1 <= self.concurrency <= 8:
            raise ValueError("Renderer concurrency must be between 1 and 8")
        if self.chunk_frames <= 0:
            raise ValueError("Renderer chunk size must be positive")
        if self.timeout_seconds <= 0:
            raise ValueError("Renderer timeout must be positive")
        if self.bitrate is not None and not re.fullmatch(r"[1-9][0-9]*(?:k|M|G)", self.bitrate):
            raise ValueError("Renderer bitrate must look like 192k, 12M, or 1G")


class SubprocessRendererClient:
    """Production renderer client with CAS, process, and output trust boundaries."""

    renderer_id = "alystria-node-renderer"

    def __init__(
        self,
        store: ProjectStore,
        runtime: RendererRuntimePins,
        *,
        options: RendererOptions | None = None,
        runner: RendererCommandRunner | None = None,
        cancel_check: Callable[[], bool] | None = None,
    ) -> None:
        self.store = store
        self.runtime = runtime
        self.options = options or RendererOptions()
        self.runner = runner or SubprocessCommandRunner()
        self.cancel_check = cancel_check
        self.renderer_version = runtime.renderer_version
        self._cancelled = threading.Event()

    def cancel(self) -> None:
        """Request cancellation; the runner terminates the Node process group."""

        self._cancelled.set()

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        self._raise_if_cancelled()
        self._verify_runtime()
        staging_parent = _guarded_child(self.store.root, self.store.root / "staging" / "renderer")
        staging_parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="attempt-", dir=staging_parent) as temporary:
            attempt_root = _guarded_child(staging_parent, Path(temporary))
            audio_root = _guarded_child(attempt_root, attempt_root / "audio")
            output_root = _guarded_child(attempt_root, attempt_root / "output")
            audio_root.mkdir()
            output_root.mkdir()
            manifest = self._build_manifest(request, audio_root, output_root)
            manifest_path = _guarded_child(attempt_root, attempt_root / "render-manifest.json")
            manifest_bytes = (_canonical_json(manifest) + "\n").encode()
            manifest_path.write_bytes(manifest_bytes)
            output_name = _delivery_name(self.options.codec)
            argv = self._render_argv(manifest_path, output_root, output_name)
            result = self.runner.run(
                argv,
                cwd=attempt_root,
                timeout_seconds=self.options.timeout_seconds,
                cancelled=self._is_cancelled,
            )
            if result.exit_code != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "no process output"
                raise RendererRuntimeError(
                    f"Renderer exited with code {result.exit_code}: {detail[-4_096:]}"
                )
            output_path = _guarded_child(output_root, output_root / "render-output.json")
            output = self._read_output_manifest(output_path, output_root, manifest)
            delivery = _delivery_record(output)
            delivery_path = _validated_output_file(output_root, delivery)
            content = delivery_path.read_bytes()
            if len(content) != _required_int(delivery, "bytes", minimum=1):
                raise RendererOutputError("Delivery size changed after renderer validation")
            safe_manifest = _portable_output_manifest(output)
            return RenderedTutorial(
                content=content,
                media_type=(
                    "video/webm" if delivery_path.suffix.casefold() in {".webm", ".mkv"} else "video/mp4"
                ),
                original_name=delivery_path.name,
                manifest=safe_manifest,
                metrics=_render_metrics(output),
            )

    def _build_manifest(
        self,
        request: Mapping[str, Any],
        audio_root: Path,
        output_root: Path,
    ) -> dict[str, Any]:
        if request.get("schemaVersion") != 1:
            raise ValueError("Renderer request requires schemaVersion 1")
        storyboard = request.get("storyboard")
        storyboard_value = storyboard if isinstance(storyboard, Mapping) else {}
        scenes_value = request.get("scenes", storyboard_value.get("scenes"))
        targets_value = request.get("targets", storyboard_value.get("targets"))
        if not isinstance(scenes_value, list) or not scenes_value:
            raise ValueError("Renderer request needs at least one storyboard scene")
        if not isinstance(targets_value, list) or not targets_value:
            raise ValueError("Renderer request needs at least one target")
        generation_id = _required_string(request, "generationId")
        target = _render_target(_required_mapping(targets_value[0], "target"))
        captions = request.get("captions")
        caption_map = (
            captions.get("byScene", {})
            if isinstance(captions, Mapping) and captions.get("captionsEnabled", True)
            else {}
        )
        if not isinstance(caption_map, Mapping):
            raise ValueError("Renderer scene captions must be an object")
        narration_value = request.get("narration", [])
        if not isinstance(narration_value, list):
            raise ValueError("Renderer narration must be a list")
        narration_by_scene: dict[str, Mapping[str, Any]] = {}
        for item in narration_value:
            entry = _required_mapping(item, "narration entry")
            narration_by_scene[_required_string(entry, "sceneId")] = entry

        resolved_scenes: list[dict[str, Any]] = []
        audio_inputs: list[dict[str, Any]] = []
        timeline_tick = 0
        deterministic_seed = request.get("seed", 0)
        for index, scene_value in enumerate(scenes_value):
            scene = _required_mapping(scene_value, f"scene {index}")
            scene_id = _required_string(scene, "id")
            duration_ticks = _required_int(scene, "durationTicks", minimum=1)
            kind = _scene_kind(scene.get("type", scene.get("kind", "bullets")))
            cues_value = caption_map.get(scene_id, [])
            if not isinstance(cues_value, list):
                raise ValueError(f"Captions for scene {scene_id} must be a list")
            resolved_scenes.append(
                {
                    "id": scene_id,
                    "kind": kind,
                    "durationTicks": duration_ticks,
                    "seed": f"{deterministic_seed}:{scene_id}:{index}",
                    "content": _scene_content(scene, kind),
                    "captions": _scene_captions(cues_value, scene_id, duration_ticks),
                    "accessibilityDescription": str(
                        scene.get("accessibilityDescription")
                        or f"An explanatory {kind.replace('-', ' ')} scene titled {_required_string(scene, 'title')}"
                    ),
                    "metadata": {
                        "sourceType": str(scene.get("type", scene.get("kind", kind))),
                        "sceneIndex": index,
                    },
                }
            )
            narration = narration_by_scene.get(scene_id)
            if narration is not None:
                digest = _required_string(narration, "artifactHash")
                media_type = str(narration.get("mediaType", "audio/wav")).casefold()
                suffix = MEDIA_EXTENSIONS.get(media_type)
                if suffix is None:
                    raise ValueError(
                        f"Narration for scene {scene_id} has unsupported media type {media_type!r}"
                    )
                destination = _guarded_child(
                    audio_root,
                    audio_root / f"{index:04d}-{_safe_name(scene_id)}{suffix}",
                )
                self.store.cas.copy_to(digest, destination)
                duration_ms = _required_int(narration, "durationMs", minimum=1)
                audio_inputs.append(
                    {
                        "path": str(destination),
                        "role": "narration",
                        "startTick": timeline_tick,
                        "endTick": timeline_tick
                        + min(duration_ticks, duration_ms * TICKS_PER_MILLISECOND),
                        "gainDb": 0,
                    }
                )
            timeline_tick += duration_ticks
        if set(narration_by_scene) - {str(scene["id"]) for scene in resolved_scenes}:
            raise ValueError("Renderer narration references an unknown scene")
        return {
            "id": f"{_safe_name(generation_id)}-{target['name']}",
            "schemaVersion": 1,
            "rendererVersion": self.renderer_version,
            "target": target,
            "scenes": resolved_scenes,
            "outputDirectory": str(output_root),
            "audioInputs": audio_inputs,
            "metadata": {
                "generationId": generation_id,
                "locale": str(storyboard_value.get("locale", request.get("locale", "en-US"))),
                "sourceTimebase": str(request.get("timebase", TICKS_PER_SECOND)),
            },
        }

    def _render_argv(
        self, manifest_path: Path, output_root: Path, output_name: str
    ) -> list[str]:
        argv = [
            str(self.runtime.node.path),
            str(self.runtime.renderer_cli_path),
            "render",
            str(manifest_path),
            "--mode",
            "full",
            "--output-dir",
            str(output_root),
            "--output",
            output_name,
            "--browser",
            str(self.runtime.chromium.path),
            "--browser-version",
            self.runtime.chromium.version,
            "--browser-sha256",
            self.runtime.chromium.sha256,
            "--ffmpeg",
            str(self.runtime.ffmpeg.path),
            "--ffprobe",
            str(self.runtime.ffprobe.path),
            "--codec",
            self.options.codec,
            "--concurrency",
            str(self.options.concurrency),
            "--chunk-frames",
            str(self.options.chunk_frames),
            "--progress",
            str(output_root / "render-progress.jsonl"),
            "--discard-frame-cache",
        ]
        if self.options.quality is not None:
            argv.extend(("--quality", str(self.options.quality)))
        if self.options.bitrate is not None:
            argv.extend(("--bitrate", self.options.bitrate))
        return argv

    def _verify_runtime(self) -> None:
        for label, pin in (
            ("Node", self.runtime.node),
            ("Chromium", self.runtime.chromium),
            ("FFmpeg", self.runtime.ffmpeg),
            ("ffprobe", self.runtime.ffprobe),
        ):
            _verify_regular_file(pin.path, label, pin.sha256)
        _verify_regular_file(
            self.runtime.renderer_cli_path,
            "renderer CLI",
            self.runtime.renderer_cli_sha256,
        )
        for label, pin in (
            ("Node", self.runtime.node),
            ("FFmpeg", self.runtime.ffmpeg),
            ("ffprobe", self.runtime.ffprobe),
        ):
            result = self.runner.run(
                [str(pin.path), *pin.version_arguments],
                cwd=self.store.root,
                timeout_seconds=min(15.0, self.options.timeout_seconds),
                cancelled=self._is_cancelled,
            )
            output = f"{result.stdout}\n{result.stderr}"
            if result.exit_code != 0 or pin.version not in output:
                raise RendererRuntimeError(
                    f"{label} version probe did not report pinned version {pin.version!r}"
                )

    def _read_output_manifest(
        self,
        path: Path,
        output_root: Path,
        input_manifest: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            info = path.lstat()
        except FileNotFoundError as error:
            raise RendererOutputError("Renderer did not write render-output.json") from error
        if path.is_symlink() or not path.is_file() or info.st_size > MAX_OUTPUT_MANIFEST_BYTES:
            raise RendererOutputError("render-output.json is not a bounded regular file")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RendererOutputError(f"Could not parse render-output.json: {error}") from error
        if not isinstance(value, dict):
            raise RendererOutputError("render-output.json must contain an object")
        if value.get("schemaVersion") != 1:
            raise RendererOutputError("Renderer output has an unsupported schema version")
        if value.get("manifestId") != input_manifest["id"]:
            raise RendererOutputError("Renderer output manifestId does not match its input")
        expected_hash = hashlib.sha256(_canonical_json(input_manifest).encode()).hexdigest()
        if value.get("inputManifestSha256") != expected_hash:
            raise RendererOutputError("Renderer output input-manifest hash does not match")
        browser = _required_mapping(value.get("browser"), "renderer browser")
        if (
            browser.get("version") != self.runtime.chromium.version
            or browser.get("sha256") != self.runtime.chromium.sha256
            or browser.get("networkPolicy") != "deny"
        ):
            raise RendererOutputError("Renderer browser pin or network policy does not match")
        if Path(_required_string(browser, "executablePath")).resolve() != self.runtime.chromium.path.resolve():
            raise RendererOutputError("Renderer used a different Chromium executable")
        executables = _required_mapping(value.get("executables"), "renderer executables")
        if Path(_required_string(executables, "ffmpeg")).resolve() != self.runtime.ffmpeg.path.resolve():
            raise RendererOutputError("Renderer used a different FFmpeg executable")
        if Path(_required_string(executables, "ffprobe")).resolve() != self.runtime.ffprobe.path.resolve():
            raise RendererOutputError("Renderer used a different ffprobe executable")
        target = _required_mapping(value.get("target"), "renderer target")
        if target != input_manifest["target"]:
            raise RendererOutputError("Renderer output target does not match its input")
        files = value.get("files")
        if not isinstance(files, list) or not files:
            raise RendererOutputError("Renderer output has no files")
        kinds: set[str] = set()
        for raw_record in files:
            record = _required_mapping(raw_record, "renderer output file")
            kind = _required_string(record, "kind")
            if kind in kinds:
                raise RendererOutputError(f"Renderer output contains duplicate {kind!r} files")
            kinds.add(kind)
            _validated_output_file(output_root, record)
        if "delivery" not in kinds:
            raise RendererOutputError("Renderer output has no delivery file")
        _validate_probe(value, input_manifest)
        return cast(dict[str, Any], value)

    def _is_cancelled(self) -> bool:
        return self._cancelled.is_set() or bool(self.cancel_check and self.cancel_check())

    def _raise_if_cancelled(self) -> None:
        if self._is_cancelled():
            raise RendererCancelledError("Render cancelled")


def create_production_renderer_client(
    store: ProjectStore,
    *,
    repository_root: Path | None = None,
    runtime_pack_root: Path | None = None,
    node_path: Path | None = None,
    chromium_path: Path | None = None,
    ffmpeg_path: Path | None = None,
    ffprobe_path: Path | None = None,
    runtime_manifest_path: Path | None = None,
    renderer_cli_path: Path | None = None,
    options: RendererOptions | None = None,
    runner: RendererCommandRunner | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> SubprocessRendererClient:
    """Build a client pinned to the current signed-runtime manifest and files.

    The factory hashes every selected executable immediately. Chromium's hash
    must additionally equal the release manifest; FFmpeg/ffprobe/Node are then
    rechecked before each render so runtime replacement cannot go unnoticed.
    """

    if repository_root is None and runtime_pack_root is None:
        raise RendererRuntimeError(
            "A production renderer requires a verified installed pack or repository runtime root"
        )
    root = (
        runtime_pack_root.resolve(strict=True)
        if runtime_pack_root is not None
        else cast(Path, repository_root).resolve(strict=True)
    )
    if not root.is_dir() or root.is_symlink():
        raise RendererRuntimeError("The renderer runtime root must be a safe directory")
    manifest_path = (runtime_manifest_path or root / "runtime-manifest.json").resolve(strict=True)
    try:
        manifest_path.relative_to(root)
    except ValueError as error:
        raise RendererRuntimeError("The runtime manifest must be inside its verified pack") from error
    manifest = _read_json_object(manifest_path, "runtime manifest")
    components_value = manifest.get("components")
    if isinstance(components_value, list):
        components: dict[str, Mapping[str, Any]] = {}
        for value in components_value:
            component = _required_mapping(value, "runtime component")
            component_id = _required_string(component, "id")
            if component_id in components:
                raise RendererRuntimeError(
                    f"Runtime manifest contains duplicate component {component_id!r}"
                )
            components[component_id] = component
        required_ids = {"node", "renderer-cli", "chromium", "ffmpeg", "ffprobe"}
        missing = sorted(required_ids - components.keys())
        if missing:
            raise RendererRuntimeError(
                f"Installed renderer pack is incomplete: {', '.join(missing)}"
            )

        def installed_component(component_id: str) -> tuple[Path, str, str]:
            component = components[component_id]
            relative = Path(_required_string(component, "relativePath"))
            if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                raise RendererRuntimeError(
                    f"Runtime component {component_id!r} has an unsafe installed path"
                )
            candidate = root / relative
            try:
                info = candidate.lstat()
            except OSError as error:
                raise RendererRuntimeError(
                    f"Runtime component {component_id!r} is unavailable: {error}"
                ) from error
            if candidate.is_symlink() or not candidate.is_file() or info.st_size <= 0:
                raise RendererRuntimeError(
                    f"Runtime component {component_id!r} must be a non-empty regular file"
                )
            resolved = candidate.resolve(strict=True)
            try:
                resolved.relative_to(root)
            except ValueError as error:
                raise RendererRuntimeError(
                    f"Runtime component {component_id!r} escapes its verified pack"
                ) from error
            return (
                resolved,
                _required_string(component, "version"),
                _required_string(component, "sha256"),
            )

        installed_node, node_version, node_sha256 = installed_component("node")
        installed_cli, renderer_version, cli_sha256 = installed_component("renderer-cli")
        installed_chromium, chromium_version, chromium_sha256 = installed_component("chromium")
        installed_ffmpeg, ffmpeg_version, ffmpeg_sha256 = installed_component("ffmpeg")
        installed_ffprobe, ffprobe_version, ffprobe_sha256 = installed_component("ffprobe")

        def selected_path(label: str, supplied: Path | None, installed: Path) -> Path:
            selected = (supplied or installed).resolve(strict=True)
            if selected != installed:
                raise RendererRuntimeError(
                    f"{label} path does not match the verified installed runtime pack"
                )
            return selected

        node = selected_path("Node", node_path, installed_node)
        cli = selected_path("Renderer CLI", renderer_cli_path, installed_cli)
        chromium = selected_path("Chromium", chromium_path, installed_chromium)
        ffmpeg = selected_path("FFmpeg", ffmpeg_path, installed_ffmpeg)
        ffprobe = selected_path("ffprobe", ffprobe_path, installed_ffprobe)
    else:
        # Explicit repository mode remains useful for opt-in renderer smoke tests,
        # but is never inferred by the packaged worker.
        if repository_root is None:
            raise RendererRuntimeError("Installed runtime manifest has no component ledger")
        toolchains = _required_mapping(manifest.get("toolchains"), "runtime toolchains")
        renderer = _required_mapping(manifest.get("renderer"), "runtime renderer")
        media = _required_mapping(manifest.get("media"), "runtime media")
        node_spec = _required_mapping(toolchains.get("node"), "Node runtime")
        chromium_spec = _required_mapping(renderer.get("chromium"), "Chromium runtime")
        ffmpeg_spec = _required_mapping(media.get("ffmpeg"), "FFmpeg runtime")
        if any(path is None for path in (node_path, chromium_path, ffmpeg_path, ffprobe_path)):
            raise RendererRuntimeError("Repository renderer mode requires every executable path")
        node = cast(Path, node_path).resolve(strict=True)
        chromium = cast(Path, chromium_path).resolve(strict=True)
        ffmpeg = cast(Path, ffmpeg_path).resolve(strict=True)
        ffprobe = cast(Path, ffprobe_path).resolve(strict=True)
        cli = (
            renderer_cli_path or root / "services" / "renderer" / "dist" / "src" / "cli.js"
        ).resolve(strict=True)
        package = _read_json_object(
            root / "services" / "renderer" / "package.json", "renderer package manifest"
        )
        node_version = _required_string(node_spec, "version")
        node_sha256 = _sha256_file(node)
        chromium_version = _required_string(chromium_spec, "browserVersion")
        chromium_sha256 = _required_string(chromium_spec, "executableSha256")
        ffmpeg_version = _required_string(ffmpeg_spec, "version")
        ffmpeg_sha256 = _sha256_file(ffmpeg)
        ffprobe_version = ffmpeg_version
        ffprobe_sha256 = _sha256_file(ffprobe)
        renderer_version = _required_string(package, "version")
        cli_sha256 = _sha256_file(cli)

    pins = RendererRuntimePins(
        node=PinnedExecutable(
            node,
            node_version,
            node_sha256,
            ("--version",),
        ),
        renderer_cli_path=cli,
        renderer_cli_sha256=cli_sha256,
        chromium=PinnedExecutable(
            chromium,
            chromium_version,
            chromium_sha256,
            ("--version",),
        ),
        ffmpeg=PinnedExecutable(
            ffmpeg,
            ffmpeg_version,
            ffmpeg_sha256,
            ("-version",),
        ),
        ffprobe=PinnedExecutable(
            ffprobe,
            ffprobe_version,
            ffprobe_sha256,
            ("-version",),
        ),
        renderer_version=renderer_version,
    )
    for label, path, expected in (
        ("Node", node, pins.node.sha256),
        ("renderer CLI", cli, pins.renderer_cli_sha256),
        ("Chromium", chromium, pins.chromium.sha256),
        ("FFmpeg", ffmpeg, pins.ffmpeg.sha256),
        ("ffprobe", ffprobe, pins.ffprobe.sha256),
    ):
        if _sha256_file(path) != expected:
            raise RendererRuntimeError(f"{label} does not match runtime-manifest.json")
    return SubprocessRendererClient(
        store,
        pins,
        options=options,
        runner=runner,
        cancel_check=cancel_check,
    )


def _bounded_decode(value: bytes) -> str:
    return value[-MAX_PROCESS_OUTPUT_BYTES:].decode("utf-8", errors="replace")


def _kill_process_group(process_id: int, signal_number: int) -> None:
    kill_group = getattr(os, "killpg", None)
    if not callable(kill_group):
        raise OSError("Process-group signalling is unavailable")
    kill_group(process_id, signal_number)


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.resolve(strict=True).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_regular_file(path: Path, label: str, expected_sha256: str) -> None:
    try:
        original_info = path.lstat()
        resolved = path.resolve(strict=True)
        info = resolved.lstat()
    except OSError as error:
        raise RendererRuntimeError(f"Pinned {label} is unavailable: {error}") from error
    if (
        path.is_symlink()
        or not path.is_file()
        or original_info.st_size <= 0
        or not resolved.is_file()
        or info.st_size <= 0
    ):
        raise RendererRuntimeError(f"Pinned {label} must be a non-empty regular file")
    if _sha256_file(resolved) != expected_sha256:
        raise RendererRuntimeError(f"Pinned {label} SHA-256 does not match")


def _guarded_child(root: Path, candidate: Path) -> Path:
    root = root.resolve(strict=False)
    candidate = candidate.resolve(strict=False)
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise RendererOutputError(f"Renderer path escapes guarded root {root}") from error
    if candidate == root:
        raise RendererOutputError("Renderer path must be below its guarded root")
    return candidate


def _required_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return cast(Mapping[str, Any], value)


def _required_string(value: Mapping[str, Any], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{key} must be a non-empty string")
    if "\x00" in result:
        raise ValueError(f"{key} cannot contain a NUL byte")
    return result


def _required_int(
    value: Mapping[str, Any], key: str, *, minimum: int = 0, maximum: int = 2**53 - 1
) -> int:
    result = value.get(key)
    if (
        not isinstance(result, int)
        or isinstance(result, bool)
        or result < minimum
        or result > maximum
    ):
        raise ValueError(f"{key} must be an integer in [{minimum}, {maximum}]")
    return result


def _safe_name(value: str) -> str:
    result = SAFE_NAME_PATTERN.sub("-", value).strip("-_")
    if not result:
        result = hashlib.sha256(value.encode()).hexdigest()[:16]
    return result[:96]


def _scene_kind(value: object) -> str:
    normalized = str(value).strip().casefold().replace("_", "-").replace(" ", "-")
    aliases = {
        "sectionintro": "section-intro",
        "workedexample": "worked-example",
        "imagefocus": "image-focus",
        "imagecomparison": "image-comparison",
        "documentfocus": "document-focus",
        "uidemo": "ui-demo",
        "screenrecording": "screen-recording",
        "presenterslide": "presenter-slide",
    }
    normalized = aliases.get(normalized.replace("-", ""), normalized)
    return normalized if normalized in SUPPORTED_SCENE_KINDS else "bullets"


def _scene_content(scene: Mapping[str, Any], kind: str) -> dict[str, Any]:
    title = _required_string(scene, "title")
    narration = str(scene.get("narration", "")).strip()
    visual_intent = str(scene.get("visualIntent", "")).strip()
    sentence_items = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+", narration)
        if part.strip() and part.strip() != title
    ][:5]
    return {
        "eyebrow": kind.replace("-", " ").upper(),
        "title": title,
        "body": visual_intent or narration or None,
        "accent": "#5658E8",
        "items": sentence_items,
    }


def _scene_captions(
    cues: list[object], scene_id: str, duration_ticks: int
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, raw_cue in enumerate(cues):
        cue = _required_mapping(raw_cue, f"caption {index} for {scene_id}")
        start_ms = _required_int(cue, "start_ms")
        end_ms = _required_int(cue, "end_ms", minimum=1)
        start_tick = min(duration_ticks - 1, start_ms * TICKS_PER_MILLISECOND)
        end_tick = min(duration_ticks, end_ms * TICKS_PER_MILLISECOND)
        if end_tick <= start_tick:
            continue
        result.append(
            {
                "id": f"{_safe_name(str(cue.get('cue_id', 'cue')))}-{index:04d}",
                "startTick": start_tick,
                "endTick": end_tick,
                "text": _required_string(cue, "text"),
                **(
                    {"speaker": str(cue["speaker"])}
                    if isinstance(cue.get("speaker"), str) and str(cue["speaker"]).strip()
                    else {}
                ),
                "position": "top" if int(cue.get("line", 0) or 0) < 0 else "bottom",
            }
        )
    return sorted(result, key=lambda item: (int(item["startTick"]), str(item["id"])))


def _render_target(value: Mapping[str, Any]) -> dict[str, Any]:
    width = _required_int(value, "width", minimum=64, maximum=16_384)
    height = _required_int(value, "height", minimum=64, maximum=16_384)
    fps_value = value.get("fps")
    if not isinstance(fps_value, (int, float)) or isinstance(fps_value, bool) or fps_value <= 0:
        raise ValueError("Target fps must be positive")
    if abs(float(fps_value) - 23.976) < 0.001:
        frame_rate = {"numerator": 24_000, "denominator": 1_001}
    elif abs(float(fps_value) - 29.97) < 0.001:
        frame_rate = {"numerator": 30_000, "denominator": 1_001}
    elif abs(float(fps_value) - 59.94) < 0.001:
        frame_rate = {"numerator": 60_000, "denominator": 1_001}
    elif float(fps_value).is_integer():
        frame_rate = {"numerator": int(fps_value), "denominator": 1}
    else:
        raise ValueError("Target fps must be an integer or 23.976/29.97/59.94")
    raw_name = str(value.get("name", "custom")).casefold()
    if raw_name not in {"landscape", "portrait", "square", "custom"}:
        raw_name = "square" if width == height else "landscape" if width > height else "portrait"
    return {
        "name": raw_name,
        "width": width,
        "height": height,
        "pixelRatio": 1,
        "frameRate": frame_rate,
        "colorSpace": "srgb-rec709",
    }


def _delivery_name(codec: str) -> str:
    return "tutorial.webm" if codec in {"vp9", "av1"} else "tutorial.mp4"


def _validated_output_file(root: Path, record: Mapping[str, Any]) -> Path:
    raw_path = Path(_required_string(record, "path"))
    path = raw_path if raw_path.is_absolute() else root / raw_path
    path = _guarded_child(root, path)
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise RendererOutputError(f"Renderer output is missing: {path.name}") from error
    if path.is_symlink() or not path.is_file() or info.st_size <= 0:
        raise RendererOutputError(f"Renderer output is not a non-empty regular file: {path.name}")
    if info.st_size != _required_int(record, "bytes", minimum=1):
        raise RendererOutputError(f"Renderer output size does not match: {path.name}")
    digest = _required_string(record, "sha256")
    if not SHA256_PATTERN.fullmatch(digest) or _sha256_file(path) != digest:
        raise RendererOutputError(f"Renderer output SHA-256 does not match: {path.name}")
    return path


def _delivery_record(output: Mapping[str, Any]) -> Mapping[str, Any]:
    files = cast(list[object], output["files"])
    for raw_record in files:
        record = _required_mapping(raw_record, "renderer output file")
        if record.get("kind") == "delivery":
            return record
    raise RendererOutputError("Renderer output has no delivery file")


def _validate_probe(output: Mapping[str, Any], input_manifest: Mapping[str, Any]) -> None:
    probe = _required_mapping(output.get("probe"), "renderer probe")
    target = cast(Mapping[str, Any], input_manifest["target"])
    if probe.get("width") != target["width"] or probe.get("height") != target["height"]:
        raise RendererOutputError("Renderer probe dimensions do not match the target")
    if probe.get("audioSampleRate") != 48_000:
        raise RendererOutputError("Renderer delivery is not 48 kHz")
    if not isinstance(probe.get("durationSeconds"), (int, float)) or float(
        probe["durationSeconds"]
    ) <= 0:
        raise RendererOutputError("Renderer probe duration is invalid")


def _portable_output_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(value))
    assert isinstance(result, dict)
    for record in cast(list[dict[str, Any]], result.get("files", [])):
        record["path"] = Path(str(record["path"])).name
    browser = result.get("browser")
    if isinstance(browser, dict):
        browser["executablePath"] = Path(str(browser.get("executablePath", ""))).name
    executables = result.get("executables")
    if isinstance(executables, dict):
        for name in ("ffmpeg", "ffprobe"):
            executables[name] = Path(str(executables.get(name, ""))).name
    for key in ("progressPath", "outputManifestPath"):
        if isinstance(result.get(key), str):
            result[key] = Path(result[key]).name
    return cast(dict[str, Any], result)


def _render_metrics(output: Mapping[str, Any]) -> dict[str, Any]:
    probe = _required_mapping(output.get("probe"), "renderer probe")
    return {
        "deterministic": True,
        "networkPolicy": "deny",
        "frameCount": _required_int(output, "frameCount", minimum=1),
        "durationTicks": _required_int(output, "durationTicks", minimum=1),
        "durationSeconds": float(probe["durationSeconds"]),
        "videoCodec": str(probe.get("videoCodec", "unknown")),
        "audioCodec": str(probe.get("audioCodec", "unknown")),
        "audioSampleRateHz": _required_int(probe, "audioSampleRate", minimum=1),
        "audioChannels": _required_int(probe, "audioChannels", minimum=1),
        "captionCodec": str(probe.get("captionCodec", "unknown")),
        "width": _required_int(probe, "width", minimum=1),
        "height": _required_int(probe, "height", minimum=1),
        "frameRate": str(probe.get("frameRate", "unknown")),
        "blankFrames": 0,
        "captionCollisions": 0,
    }


def _read_json_object(path: Path, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RendererRuntimeError(f"Could not read {label}: {error}") from error
    if not isinstance(value, dict):
        raise RendererRuntimeError(f"{label} must contain a JSON object")
    return cast(Mapping[str, Any], value)
