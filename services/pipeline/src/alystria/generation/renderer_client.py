"""Guarded subprocess bridge to Alystria's deterministic Node renderer."""

from __future__ import annotations

import hashlib
import json
import math
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
SUPPORTED_CODECS = frozenset({"vp9", "av1", "h264_nvenc", "h264_mf", "libx264", "hevc_nvenc"})
SUPPORTED_CAPTION_DELIVERY_MODES = frozenset({"sidecar", "embedded", "burned", "both"})
VISUAL_SEMANTIC_INTENTS = frozenset(
    {
        "establish",
        "define",
        "compare",
        "transform",
        "demonstrate",
        "prove",
        "emphasize",
        "question",
        "resolve",
        "recap",
    }
)
VISUAL_COMPOSITION_FAMILIES = frozenset(
    {
        "full_bleed",
        "editorial_type",
        "object_stage",
        "diagram",
        "split_evidence",
        "document_focus",
        "data_canvas",
        "worked_example",
        "presenter",
        "cinematic_scale",
    }
)
VISUAL_MOTION_INTENTS = frozenset(
    {
        "reveal-primary",
        "trace-relationship",
        "transform-object",
        "compare-shift",
        "evidence-focus",
        "resolve-hold",
        "quiet-hold",
        "match-transition",
        "emphasize-result",
        "resolve-answer",
        "question-hold",
    }
)
VISUAL_TEXT_ROLE_KEYS = frozenset(
    {
        "eyebrow",
        "hero",
        "support",
        "label",
        "markers",
        "principle",
        "focus",
        "proof",
        "result",
        "counterpoint",
        "formula",
        "answer",
        "title",
        "subtitle",
        "kicker",
        "value",
    }
)
VISUAL_INFORMATION_UNIT_KEYS = frozenset(
    {"id", "role", "text", "label", "value", "values", "low", "middle", "high", "relation"}
)
VISUAL_AVOID_REGION_KEYS = frozenset({"id", "role", "x", "y", "width", "height", "priority"})
VISUAL_AVOID_REGION_ROLES = frozenset({"title", "essential-visual", "presenter", "source"})
VISUAL_FORBIDDEN_PAYLOAD_KEYS = frozenset(
    {
        "argv",
        "code",
        "command",
        "component",
        "css",
        "executable",
        "href",
        "html",
        "javascript",
        "path",
        "render",
        "script",
        "src",
        "style",
        "template",
        "url",
    }
)
VISUAL_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
VISUAL_UNSAFE_TEXT_PATTERN = re.compile(
    r"(?:https?://|file:|data:|javascript:|[A-Za-z]:[\\/]|"
    r"(?:^|\s)\.\.?[\\/]|(?:^|\s)[\\/](?:Users|home|etc|tmp|mnt|var|Windows|Program\s+Files)[\\/])",
    re.IGNORECASE,
)
VISUAL_HTML_PATTERN = re.compile(r"<\s*/?\s*[A-Za-z][^>]{0,200}>")
MEDIA_EXTENSIONS = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
}
VISUAL_MEDIA_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
FONT_MEDIA_EXTENSIONS = {
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "font/woff": ".woff",
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
                    _kill_process_group(
                        process.pid, int(getattr(signal, "SIGKILL", signal.SIGTERM))
                    )
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
    caption_delivery_mode: str = "sidecar"

    def __post_init__(self) -> None:
        if self.codec not in SUPPORTED_CODECS:
            raise ValueError(f"Unsupported renderer codec {self.codec!r}")
        if self.caption_delivery_mode not in SUPPORTED_CAPTION_DELIVERY_MODES:
            raise ValueError(f"Unsupported caption delivery mode {self.caption_delivery_mode!r}")
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
            visual_root = _guarded_child(attempt_root, attempt_root / "visuals")
            font_root = _guarded_child(attempt_root, attempt_root / "fonts")
            presenter_root = _guarded_child(attempt_root, attempt_root / "presenters")
            output_root = _guarded_child(attempt_root, attempt_root / "output")
            audio_root.mkdir()
            visual_root.mkdir()
            font_root.mkdir()
            presenter_root.mkdir()
            output_root.mkdir()
            manifest = self._build_manifest(
                request, audio_root, visual_root, font_root, presenter_root, output_root
            )
            manifest_path = _guarded_child(attempt_root, attempt_root / "render-manifest.json")
            manifest_bytes = (_canonical_json(manifest) + "\n").encode()
            manifest_path.write_bytes(manifest_bytes)
            input_manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
            output_name = _delivery_name(self.options.codec)
            caption_delivery_mode = _caption_delivery_mode(manifest["captionDeliveryMode"])
            caption_language = _caption_language(manifest["metadata"]["locale"])
            argv = self._render_argv(
                manifest_path,
                output_root,
                output_name,
                caption_delivery_mode,
                caption_language,
            )
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
            output = self._read_output_manifest(
                output_path,
                output_root,
                manifest,
                input_manifest_sha256,
                caption_delivery_mode,
                caption_language,
            )
            delivery = _delivery_record(output)
            delivery_path = _validated_output_file(output_root, delivery)
            content = delivery_path.read_bytes()
            if len(content) != _required_int(delivery, "bytes", minimum=1):
                raise RendererOutputError("Delivery size changed after renderer validation")
            safe_manifest = _portable_output_manifest(output)
            return RenderedTutorial(
                content=content,
                media_type=(
                    "video/webm"
                    if delivery_path.suffix.casefold() in {".webm", ".mkv"}
                    else "video/mp4"
                ),
                original_name=delivery_path.name,
                manifest=safe_manifest,
                metrics=_render_metrics(output),
            )

    def _build_manifest(
        self,
        request: Mapping[str, Any],
        audio_root: Path,
        visual_root: Path,
        font_root: Path,
        presenter_root: Path,
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
        presenters_value = request.get("presenters", [])
        if not isinstance(presenters_value, list):
            raise ValueError("Renderer presenters must be a list")
        presenters_by_scene: dict[str, Mapping[str, Any]] = {}
        for index, item in enumerate(presenters_value):
            entry = _required_mapping(item, f"presenter entry {index}")
            scene_id = _required_string(entry, "sceneId")
            if scene_id in presenters_by_scene:
                raise ValueError(f"Renderer has more than one presenter for scene {scene_id}")
            presenters_by_scene[scene_id] = entry

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
            scene_metadata: dict[str, str | int] = {
                "sourceType": str(scene.get("type", scene.get("kind", kind))),
                "sceneIndex": index,
            }
            for metadata_key in (
                "presenterName",
                "presenterDisclosure",
                "presenterPlacement",
                "presenterFit",
            ):
                metadata_value = scene.get(metadata_key)
                if isinstance(metadata_value, str) and metadata_value.strip():
                    scene_metadata[metadata_key] = metadata_value.strip()[:200]
            scene_content = _scene_content(scene, kind)
            authored_visual_beat = scene_content.get("visualBeat")
            if isinstance(authored_visual_beat, Mapping):
                # The current frame compiler consumes focal/continuity metadata
                # directly. Keep the complete inert contract in scene content,
                # while lifting the bounded scalar directions for backwards-
                # compatible renderer versions.
                for metadata_key in (
                    "semanticIntent",
                    "compositionFamily",
                    "focalAnchor",
                    "continuityKey",
                    "attentionCue",
                    "visualMetaphor",
                ):
                    metadata_value = authored_visual_beat.get(metadata_key)
                    if isinstance(metadata_value, str):
                        scene_metadata[metadata_key] = metadata_value
            resolved_scenes.append(
                {
                    "id": scene_id,
                    "kind": kind,
                    "durationTicks": duration_ticks,
                    "seed": f"{deterministic_seed}:{scene_id}:{index}",
                    "content": scene_content,
                    "captions": _scene_captions(cues_value, scene_id, duration_ticks),
                    "accessibilityDescription": str(
                        scene.get("accessibilityDescription")
                        or f"An explanatory {kind.replace('-', ' ')} scene titled {_required_string(scene, 'title')}"
                    ),
                    "metadata": scene_metadata,
                }
            )
            narration = narration_by_scene.get(scene_id)
            if narration is not None:
                digest = _required_string(narration, "artifactHash").lower()
                if not SHA256_PATTERN.fullmatch(digest) or not self.store.cas.verify(digest):
                    raise RendererOutputError(
                        f"Narration artifact for scene {scene_id} is missing or corrupt"
                    )
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
                _validate_staged_audio(destination, audio_root, digest, scene_id)
                duration_ms = _required_int(narration, "durationMs", minimum=1)
                audio_inputs.append(
                    {
                        "id": f"narration-{index:04d}-{_safe_name(scene_id)}",
                        "assetId": f"scene-narration:{scene_id}",
                        "path": _subprocess_command_path(destination),
                        "sha256": digest,
                        "mediaType": media_type,
                        "role": "narration",
                        "startTick": timeline_tick,
                        "endTick": timeline_tick
                        + min(duration_ticks, duration_ms * TICKS_PER_MILLISECOND),
                        "gainDb": 0,
                    }
                )
            timeline_tick += duration_ticks
        audio_inputs.extend(
            self._materialize_program_audio(
                request.get("audioCustomization"),
                resolved_scenes,
                timeline_tick,
                audio_root,
            )
        )
        if set(narration_by_scene) - {str(scene["id"]) for scene in resolved_scenes}:
            raise ValueError("Renderer narration references an unknown scene")
        unknown_presenters = set(presenters_by_scene) - {
            str(scene["id"]) for scene in resolved_scenes
        }
        if unknown_presenters:
            raise ValueError(
                "Renderer presenter references an unknown scene: "
                + ", ".join(sorted(unknown_presenters))
            )
        custom_visual_assets, caption_style = _render_visual_customization(
            request.get("visualCustomization"), resolved_scenes
        )
        font_inputs, typography = self._materialize_font_assets(
            request.get("fontCustomization"), font_root
        )
        caption_style = {**caption_style, "fontFamily": typography["captionFamily"]}
        generated_assets = request.get("assets", [])
        if not isinstance(generated_assets, list):
            raise ValueError("Renderer assets must be a list")
        # Explicit project/starter choices take precedence for a semantic role.
        # Generated candidates remain in provenance, but duplicate backgrounds
        # and portraits do not silently cover the user's selection.
        visual_inputs, visuals_by_scene = self._materialize_visual_assets(
            [*custom_visual_assets, *generated_assets],
            resolved_scenes,
            visual_root,
        )
        for scene in resolved_scenes:
            scene_visuals = visuals_by_scene.get(str(scene["id"]), [])
            if scene_visuals:
                scene["visualAssets"] = scene_visuals
        presenter_videos = self._materialize_presenter_videos(
            presenters_by_scene,
            resolved_scenes,
            presenter_root,
        )
        request_metadata = request.get("metadata")
        metadata_caption_mode = (
            request_metadata.get("captionDeliveryMode")
            if isinstance(request_metadata, Mapping)
            else None
        )
        return {
            "id": f"{_safe_name(generation_id)}-{target['name']}",
            "schemaVersion": 1,
            "rendererVersion": self.renderer_version,
            "target": target,
            "scenes": resolved_scenes,
            "outputDirectory": _subprocess_command_path(output_root),
            "audioInputs": audio_inputs,
            "captionDeliveryMode": _caption_delivery_mode(
                request.get(
                    "captionDeliveryMode",
                    metadata_caption_mode or self.options.caption_delivery_mode,
                )
            ),
            "captionStyle": caption_style,
            **({"visualAssets": visual_inputs} if visual_inputs else {}),
            **({"fontAssets": font_inputs} if font_inputs else {}),
            "typography": typography,
            **({"presenterVideos": presenter_videos} if presenter_videos else {}),
            "metadata": {
                "generationId": generation_id,
                "locale": str(storyboard_value.get("locale", request.get("locale", "en-US"))),
                "sourceTimebase": str(request.get("timebase", TICKS_PER_SECOND)),
            },
        }

    def _materialize_font_assets(
        self,
        value: object,
        font_root: Path,
    ) -> tuple[list[dict[str, Any]], dict[str, str]]:
        """Stage only selected, inspected, rights-cleared CAS font objects."""

        fallback = {
            "displayFamily": "Bricolage Grotesque",
            "bodyFamily": "Atkinson Hyperlegible Next",
            "codeFamily": "JetBrains Mono",
            "captionFamily": "Atkinson Hyperlegible Next",
        }
        if value is None:
            return [], fallback
        customization = _required_mapping(value, "font customization")
        assets_value = customization.get("fontAssets", [])
        if not isinstance(assets_value, list):
            raise ValueError("Renderer font customization assets must be a list")
        typography_value = _required_mapping(
            customization.get("typography", fallback), "font typography"
        )
        typography = {
            field: _font_family(typography_value.get(field), f"typography.{field}")
            for field in (
                "displayFamily",
                "bodyFamily",
                "codeFamily",
                "captionFamily",
            )
        }
        result: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        seen_roles: set[str] = set()
        for index, raw in enumerate(assets_value):
            item = _required_mapping(raw, f"font asset {index}")
            if any(key in item for key in ("path", "url", "uri", "contentBase64")):
                raise ValueError(
                    "Font customization must not contain paths, URLs, or embedded bytes"
                )
            asset_id = _required_string(item, "id")
            if asset_id in seen_ids:
                raise ValueError(f"Renderer font asset {asset_id!r} is duplicated")
            seen_ids.add(asset_id)
            digest = _required_string(item, "artifactHash").lower()
            if not SHA256_PATTERN.fullmatch(digest) or not self.store.cas.verify(digest):
                raise RendererOutputError(f"Font artifact {asset_id!r} is missing or corrupt")
            row = self.store.connection.execute(
                "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
            ).fetchone()
            if row is None:
                raise RendererOutputError(f"Font artifact {asset_id!r} is not registered")
            registered_media_type = str(row["media_type"]).casefold()
            declared_media_type = _required_string(item, "mediaType").casefold()
            suffix = FONT_MEDIA_EXTENSIONS.get(registered_media_type)
            if declared_media_type != registered_media_type or suffix is None:
                raise RendererOutputError(
                    f"Font artifact {asset_id!r} has no render-safe media registration"
                )
            family = _required_string(item, "family")
            expected_family = f"AlystriaImported-{digest[:16]}"
            if family != expected_family:
                raise ValueError(f"Font artifact {asset_id!r} family alias does not match its hash")
            roles_value = item.get("roles")
            if not isinstance(roles_value, list) or not 1 <= len(roles_value) <= 4:
                raise ValueError(f"Font artifact {asset_id!r} has invalid roles")
            roles: list[str] = []
            for role_value in roles_value:
                role = _enum_value(
                    role_value,
                    {"display", "body", "code", "caption"},
                    "font role",
                )
                if role in roles or role in seen_roles:
                    raise ValueError(f"Font role {role!r} is duplicated")
                roles.append(role)
                seen_roles.add(role)
            inspection = _enum_value(
                item.get("inspectionStatus"),
                {"metadata-inspected"},
                "font inspection status",
            )
            permission = _enum_value(
                item.get("embeddingPermission"),
                {"installable", "previewPrint", "editable"},
                "font embedding permission",
            )
            if item.get("exportEligible") is not True:
                raise ValueError(f"Font artifact {asset_id!r} is not export-cleared")
            style = _enum_value(item.get("style"), {"normal", "italic"}, "font style")
            weight_value = item.get("weight")
            weight: int | list[int]
            if isinstance(weight_value, int) and not isinstance(weight_value, bool):
                if not 1 <= weight_value <= 1_000:
                    raise ValueError("Font weight must be in [1, 1000]")
                weight = weight_value
            elif (
                isinstance(weight_value, list)
                and len(weight_value) == 2
                and all(
                    isinstance(part, int) and not isinstance(part, bool) and 1 <= part <= 1_000
                    for part in weight_value
                )
                and weight_value[0] <= weight_value[1]
            ):
                weight = [int(weight_value[0]), int(weight_value[1])]
            else:
                raise ValueError("Font weight or variable weight range is invalid")
            destination = _guarded_child(
                font_root,
                font_root / f"font-{index:04d}-{_safe_name(asset_id)}{suffix}",
            )
            self.store.cas.copy_to(digest, destination)
            resolved = _validate_staged_font(
                destination,
                font_root,
                digest,
                asset_id,
                registered_media_type,
            )
            result.append(
                {
                    "id": asset_id,
                    "path": _subprocess_command_path(resolved),
                    "sha256": digest,
                    "mediaType": registered_media_type,
                    "family": family,
                    "roles": roles,
                    "weight": weight,
                    "style": style,
                    "inspectionStatus": inspection,
                    "embeddingPermission": permission,
                    "exportEligible": True,
                }
            )
        for role, field in (
            ("display", "displayFamily"),
            ("body", "bodyFamily"),
            ("code", "codeFamily"),
            ("caption", "captionFamily"),
        ):
            family = typography[field]
            if family.startswith("AlystriaImported-") and not any(
                family == item["family"] and role in item["roles"] for item in result
            ):
                raise ValueError(f"Typography role {role!r} references an unbound imported font")
        return result, typography

    def _materialize_program_audio(
        self,
        value: object,
        scenes: Sequence[Mapping[str, Any]],
        duration_ticks: int,
        audio_root: Path,
    ) -> list[dict[str, Any]]:
        """Stage explicit music/SFX selections from the project CAS.

        The request contains only IDs, hashes, and policies produced by the
        project-audio resolver.  Filesystem paths are always generated inside
        this attempt directory and their bytes are re-hashed after copying.
        """

        if value is None:
            return []
        customization = _required_mapping(value, "audio customization")
        if customization.get("schemaVersion") != 1:
            raise ValueError("Renderer audio customization requires schemaVersion 1")
        inputs_value = customization.get("inputs", [])
        if not isinstance(inputs_value, list):
            raise ValueError("Renderer audio customization inputs must be a list")
        mix = _required_mapping(customization.get("mix", {}), "audio mix policy")
        ducking_db = _required_number(
            mix,
            "musicDuckingDb",
            minimum=-36,
            maximum=0,
        )
        result: list[dict[str, Any]] = []
        seen_asset_ids: set[str] = set()
        scene_starts = _audio_emphasis_ticks(scenes)
        for index, value_item in enumerate(inputs_value):
            item = _required_mapping(value_item, f"program audio {index}")
            asset_id = _required_string(item, "assetId")
            if asset_id in seen_asset_ids:
                raise ValueError(f"Renderer program audio asset {asset_id!r} is duplicated")
            seen_asset_ids.add(asset_id)
            role = _required_string(item, "role")
            if role not in {"music", "sfx"}:
                raise ValueError(f"Renderer program audio {asset_id!r} has unsupported role {role}")
            expected_schedule = "full-program-loop" if role == "music" else "scene-emphasis"
            if item.get("schedule") != expected_schedule:
                raise ValueError(
                    f"Renderer program audio {asset_id!r} requires schedule {expected_schedule!r}"
                )
            digest = _required_string(item, "artifactHash").lower()
            if not SHA256_PATTERN.fullmatch(digest) or not self.store.cas.verify(digest):
                raise RendererOutputError(
                    f"Program audio artifact {asset_id!r} is missing or corrupt"
                )
            row = self.store.connection.execute(
                "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
            ).fetchone()
            if row is None:
                raise RendererOutputError(f"Program audio artifact {asset_id!r} is not registered")
            registered_media_type = str(row["media_type"]).casefold()
            declared_media_type = _required_string(item, "mediaType").casefold()
            if registered_media_type != declared_media_type:
                raise RendererOutputError(
                    f"Program audio artifact {asset_id!r} media type does not match its CAS registration"
                )
            suffix = MEDIA_EXTENSIONS.get(registered_media_type)
            if suffix is None:
                raise ValueError(
                    f"Program audio artifact {asset_id!r} has unsupported media type {registered_media_type!r}"
                )
            destination = _guarded_child(
                audio_root,
                audio_root / f"program-{index:04d}-{_safe_name(asset_id)}{suffix}",
            )
            self.store.cas.copy_to(digest, destination)
            resolved = _validate_staged_audio(destination, audio_root, digest, asset_id)
            gain_db = _required_number(item, "gainDb", minimum=-96, maximum=24)
            base = {
                "assetId": asset_id,
                "path": _subprocess_command_path(resolved),
                "sha256": digest,
                "mediaType": registered_media_type,
                "role": role,
                "gainDb": gain_db,
            }
            if role == "music":
                result.append(
                    {
                        **base,
                        "id": f"music-{index:04d}-{_safe_name(asset_id)}",
                        "startTick": 0,
                        "endTick": duration_ticks,
                        "loop": True,
                        "duckingDb": ducking_db,
                    }
                )
            else:
                for cue_index, start_tick in enumerate(scene_starts):
                    result.append(
                        {
                            **base,
                            "id": f"sfx-{index:04d}-{cue_index:04d}-{_safe_name(asset_id)}",
                            "startTick": start_tick,
                        }
                    )
        return result

    def _materialize_visual_assets(
        self,
        assets_value: object,
        scenes: Sequence[Mapping[str, Any]],
        visual_root: Path,
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
        """Copy hash-verified bitmap assets from CAS into one render attempt.

        SVG and other non-bitmap generation artifacts remain in provenance but
        cannot cross this browser boundary. The browser receives only bytes;
        the absolute staging path is consumed and removed by the Node executor.
        """

        if not isinstance(assets_value, list):
            raise ValueError("Renderer assets must be a list")
        scenes_by_id = {_required_string(scene, "id"): scene for scene in scenes}
        inputs: list[dict[str, Any]] = []
        references: dict[str, list[dict[str, Any]]] = {}
        ids: dict[str, tuple[str, str]] = {}
        role_counts: dict[tuple[str, str], int] = {}
        for index, value in enumerate(assets_value):
            asset = _required_mapping(value, f"visual asset {index}")
            scene_id = _required_string(asset, "sceneId")
            scene = scenes_by_id.get(scene_id)
            if scene is None:
                raise ValueError(f"Renderer visual asset references unknown scene {scene_id}")
            artifact_hash = _required_string(asset, "artifactHash").lower()
            if not SHA256_PATTERN.fullmatch(artifact_hash) or not self.store.cas.verify(
                artifact_hash
            ):
                raise RendererOutputError(
                    f"Visual artifact for scene {scene_id} is missing or corrupt"
                )
            row = self.store.connection.execute(
                "SELECT media_type FROM artifacts WHERE hash=?", (artifact_hash,)
            ).fetchone()
            if row is None:
                raise RendererOutputError(f"Visual artifact for scene {scene_id} is not registered")
            registered_media_type = str(row["media_type"]).casefold()
            declared_media_type = str(asset.get("mediaType", registered_media_type)).casefold()
            if declared_media_type != registered_media_type:
                raise RendererOutputError(
                    f"Visual artifact for scene {scene_id} media type does not match its CAS registration"
                )
            suffix = VISUAL_MEDIA_EXTENSIONS.get(registered_media_type)
            if suffix is None:
                # Deterministic fixtures currently generate sanitized SVG
                # envelopes. Keep them as evidence, but do not send active SVG
                # content into Chromium as an image asset.
                continue
            role = _visual_asset_role(asset.get("role"), str(scene["kind"]))
            role_key = (scene_id, role)
            role_count = role_counts.get(role_key, 0)
            role_counts[role_key] = role_count + 1
            if role_count:
                if role == "primary" and role_count == 1:
                    role = "secondary"
                else:
                    continue
            requested_id = asset.get("assetId")
            asset_id = (
                _safe_name(requested_id)
                if isinstance(requested_id, str) and requested_id.strip()
                else f"visual-{index:04d}-{_safe_name(scene_id)}-{role}"
            )
            if not asset_id:
                raise ValueError("Renderer visual asset id must not be empty")
            existing = ids.get(asset_id)
            if existing is not None:
                if existing != (artifact_hash, registered_media_type):
                    raise ValueError(
                        f"Renderer visual asset id {asset_id!r} maps to conflicting immutable objects"
                    )
                references.setdefault(scene_id, []).append(
                    {
                        "assetId": asset_id,
                        "sha256": artifact_hash,
                        "role": role,
                        "alt": _visual_asset_alt(asset, scene),
                        "fit": _visual_asset_fit(asset.get("fit"), role),
                    }
                )
                continue
            ids[asset_id] = (artifact_hash, registered_media_type)
            destination = _guarded_child(
                visual_root,
                visual_root / f"{index:04d}-{_safe_name(scene_id)}-{role}{suffix}",
            )
            self.store.cas.copy_to(artifact_hash, destination)
            try:
                info = destination.lstat()
                resolved = destination.resolve(strict=True)
                resolved.relative_to(visual_root.resolve(strict=True))
            except (OSError, ValueError) as error:
                raise RendererOutputError(
                    f"Visual staging artifact for scene {scene_id} is unavailable"
                ) from error
            if destination.is_symlink() or not resolved.is_file() or info.st_size <= 0:
                raise RendererOutputError(
                    f"Visual staging artifact for scene {scene_id} is not a regular file"
                )
            if _sha256_file(resolved) != artifact_hash:
                raise RendererOutputError(
                    f"Visual staging artifact for scene {scene_id} changed during copy"
                )
            inputs.append(
                {
                    "id": asset_id,
                    "path": _subprocess_command_path(resolved),
                    "sha256": artifact_hash,
                    "mediaType": registered_media_type,
                }
            )
            references.setdefault(scene_id, []).append(
                {
                    "assetId": asset_id,
                    "sha256": artifact_hash,
                    "role": role,
                    "alt": _visual_asset_alt(asset, scene),
                    "fit": _visual_asset_fit(asset.get("fit"), role),
                }
            )
        return inputs, references

    def _materialize_presenter_videos(
        self,
        presenters_by_scene: Mapping[str, Mapping[str, Any]],
        scenes: Sequence[Mapping[str, Any]],
        presenter_root: Path,
    ) -> list[dict[str, Any]]:
        """Stage only verified MP4 presenter artifacts for the renderer.

        The durable presenter stage can also contain a deterministic JSON
        placeholder when no installed local presenter is selected.  That
        placeholder remains visible in provenance but never crosses the
        Chromium/FFmpeg media boundary.  A real video candidate must be a
        registered, hash-verified MP4 in the project CAS and must bind to a
        semantically compatible presenter scene.
        """

        bindings: list[dict[str, Any]] = []
        presenter_kinds = {"presenter", "presenter-slide", "presenter-with-slide"}
        for index, scene in enumerate(scenes):
            scene_id = _required_string(scene, "id")
            presenter = presenters_by_scene.get(scene_id)
            if presenter is None:
                continue
            artifact_hash = _required_string(presenter, "artifactHash").lower()
            if not SHA256_PATTERN.fullmatch(artifact_hash) or not self.store.cas.verify(
                artifact_hash
            ):
                raise RendererOutputError(
                    f"Presenter artifact for scene {scene_id} is missing or corrupt"
                )
            row = self.store.connection.execute(
                "SELECT media_type FROM artifacts WHERE hash=?", (artifact_hash,)
            ).fetchone()
            if row is None:
                raise RendererOutputError(
                    f"Presenter artifact for scene {scene_id} is not registered"
                )
            media_type = str(row["media_type"]).casefold()
            # Deterministic fixture presenter records intentionally use a JSON
            # metadata envelope. They are not videos and cannot be rendered as
            # one. Keeping this branch explicit prevents a disguised fallback.
            if media_type != "video/mp4":
                continue
            kind = _required_string(scene, "kind")
            if kind not in presenter_kinds:
                raise RendererOutputError(
                    f"Presenter video for scene {scene_id} requires a presenter scene, got {kind}"
                )
            destination = _guarded_child(
                presenter_root,
                presenter_root / f"{index:04d}-{_safe_name(scene_id)}.mp4",
            )
            self.store.cas.copy_to(artifact_hash, destination)
            try:
                info = destination.lstat()
                resolved = destination.resolve(strict=True)
                resolved.relative_to(presenter_root.resolve(strict=True))
            except (OSError, ValueError) as error:
                raise RendererOutputError(
                    f"Presenter staging artifact for scene {scene_id} is unavailable"
                ) from error
            if destination.is_symlink() or not resolved.is_file() or info.st_size <= 0:
                raise RendererOutputError(
                    f"Presenter staging artifact for scene {scene_id} is not a regular file"
                )
            if _sha256_file(resolved) != artifact_hash:
                raise RendererOutputError(
                    f"Presenter staging artifact for scene {scene_id} changed during copy"
                )
            binding: dict[str, Any] = {
                "id": f"presenter-{index:04d}-{_safe_name(scene_id)}",
                "path": _subprocess_command_path(resolved),
                "sha256": artifact_hash,
                "sceneId": scene_id,
                "placement": _presenter_placement(presenter),
                "fit": _presenter_fit(presenter),
            }
            source_start = presenter.get("sourceStartTick")
            if source_start is not None:
                binding["sourceStartTick"] = _required_int(presenter, "sourceStartTick", minimum=0)
            active_duration = presenter.get("activeDurationTicks")
            if active_duration is not None:
                duration_ticks = _required_int(scene, "durationTicks", minimum=1)
                binding["activeDurationTicks"] = _required_int(
                    presenter,
                    "activeDurationTicks",
                    minimum=1,
                    maximum=duration_ticks,
                )
            bindings.append(binding)
        return bindings

    def _render_argv(
        self,
        manifest_path: Path,
        output_root: Path,
        output_name: str,
        caption_delivery_mode: str,
        caption_language: str,
    ) -> list[str]:
        argv = [
            _subprocess_command_path(self.runtime.node.path),
            _subprocess_command_path(self.runtime.renderer_cli_path),
            "render",
            _subprocess_command_path(manifest_path),
            "--mode",
            "full",
            "--output-dir",
            _subprocess_command_path(output_root),
            "--output",
            output_name,
            "--browser",
            _subprocess_command_path(self.runtime.chromium.path),
            "--browser-version",
            self.runtime.chromium.version,
            "--browser-sha256",
            self.runtime.chromium.sha256,
            "--ffmpeg",
            _subprocess_command_path(self.runtime.ffmpeg.path),
            "--ffprobe",
            _subprocess_command_path(self.runtime.ffprobe.path),
            "--codec",
            self.options.codec,
            "--captions",
            caption_delivery_mode,
            "--caption-language",
            caption_language,
            "--concurrency",
            str(self.options.concurrency),
            "--chunk-frames",
            str(self.options.chunk_frames),
            "--progress",
            _subprocess_command_path(output_root / "render-progress.jsonl"),
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
        input_manifest_sha256: str,
        expected_caption_delivery_mode: str,
        expected_caption_language: str,
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
        if value.get("inputManifestSha256") != input_manifest_sha256:
            raise RendererOutputError("Renderer output input-manifest hash does not match")
        browser = _required_mapping(value.get("browser"), "renderer browser")
        if (
            browser.get("version") != self.runtime.chromium.version
            or browser.get("sha256") != self.runtime.chromium.sha256
            or browser.get("networkPolicy") != "deny"
        ):
            raise RendererOutputError("Renderer browser pin or network policy does not match")
        if (
            Path(_required_string(browser, "executablePath")).resolve()
            != self.runtime.chromium.path.resolve()
        ):
            raise RendererOutputError("Renderer used a different Chromium executable")
        executables = _required_mapping(value.get("executables"), "renderer executables")
        if (
            Path(_required_string(executables, "ffmpeg")).resolve()
            != self.runtime.ffmpeg.path.resolve()
        ):
            raise RendererOutputError("Renderer used a different FFmpeg executable")
        if (
            Path(_required_string(executables, "ffprobe")).resolve()
            != self.runtime.ffprobe.path.resolve()
        ):
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
        for required_kind in ("captions-vtt", "captions-srt", "captions-ledger"):
            if required_kind not in kinds:
                raise RendererOutputError(
                    f"Renderer output has no required {required_kind} sidecar"
                )
        caption_delivery = _required_mapping(
            value.get("captionDelivery"), "renderer caption delivery"
        )
        if caption_delivery.get("mode") != expected_caption_delivery_mode:
            raise RendererOutputError("Renderer caption delivery mode does not match its request")
        if caption_delivery.get("language") != expected_caption_language:
            raise RendererOutputError("Renderer caption language does not match its request")
        expected_burned = expected_caption_delivery_mode in {"burned", "both"}
        if caption_delivery.get("burnedIntoVideo") is not expected_burned:
            raise RendererOutputError("Renderer open-caption state does not match its request")
        expected_embedded = expected_caption_delivery_mode in {"embedded", "both"}
        cue_count = _required_int(caption_delivery, "cueCount", minimum=0)
        actual_embedded = bool(caption_delivery.get("embeddedSoftTrack"))
        if actual_embedded is not (expected_embedded and cue_count > 0):
            raise RendererOutputError("Renderer soft-caption state does not match its request")
        ledger_digest = _required_string(caption_delivery, "canonicalCueLedgerSha256")
        if not SHA256_PATTERN.fullmatch(ledger_digest):
            raise RendererOutputError("Renderer caption ledger digest is invalid")
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
        raise RendererRuntimeError(
            "The runtime manifest must be inside its verified pack"
        ) from error
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


def _subprocess_command_path(path: Path) -> str:
    r"""Spell a verified Windows path for third-party command-line tools.

    Runtime discovery keeps canonical ``\\?\`` paths for containment and hash
    checks. Node 24's Windows module loader cannot use that spelling for its
    JavaScript entry point and resolves it to the bare drive (``C:``). Removing
    only the extended prefix preserves the verified target while every argv
    element remains separate and shell-free.
    """

    value = str(path)
    if os.name != "nt":
        return value
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    if value.startswith("\\\\?\\"):
        return value[4:]
    return value


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


def _required_number(
    value: Mapping[str, Any],
    key: str,
    *,
    minimum: float,
    maximum: float,
) -> float:
    result = value.get(key)
    if (
        not isinstance(result, (int, float))
        or isinstance(result, bool)
        or not math.isfinite(float(result))
        or float(result) < minimum
        or float(result) > maximum
    ):
        raise ValueError(f"{key} must be numeric in [{minimum}, {maximum}]")
    return float(result)


def _validate_staged_audio(
    destination: Path,
    audio_root: Path,
    expected_hash: str,
    label: str,
) -> Path:
    try:
        info = destination.lstat()
        resolved = destination.resolve(strict=True)
        resolved.relative_to(audio_root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise RendererOutputError(f"Staged audio {label!r} is unavailable") from error
    if destination.is_symlink() or not resolved.is_file() or info.st_size <= 0:
        raise RendererOutputError(f"Staged audio {label!r} is not a regular file")
    if _sha256_file(resolved) != expected_hash:
        raise RendererOutputError(f"Staged audio {label!r} changed during copy")
    return resolved


def _validate_staged_font(
    destination: Path,
    font_root: Path,
    expected_hash: str,
    label: str,
    media_type: str,
) -> Path:
    try:
        info = destination.lstat()
        resolved = destination.resolve(strict=True)
        resolved.relative_to(font_root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise RendererOutputError(f"Staged font {label!r} is unavailable") from error
    if destination.is_symlink() or not resolved.is_file() or info.st_size <= 0:
        raise RendererOutputError(f"Staged font {label!r} is not a regular file")
    if info.st_size > 16 * 1024 * 1024:
        raise RendererOutputError(f"Staged font {label!r} exceeds the renderer limit")
    if _sha256_file(resolved) != expected_hash:
        raise RendererOutputError(f"Staged font {label!r} changed during copy")
    prefix = resolved.read_bytes()[:4]
    valid = (
        prefix in {b"\x00\x01\x00\x00", b"true", b"typ1"}
        if media_type == "font/ttf"
        else prefix == b"OTTO"
        if media_type == "font/otf"
        else prefix == b"wOFF"
    )
    if not valid:
        raise RendererOutputError(f"Staged font {label!r} bytes do not match {media_type}")
    return resolved


def _audio_emphasis_ticks(scenes: Sequence[Mapping[str, Any]]) -> list[int]:
    """Choose a restrained deterministic set of scene-boundary cue times."""

    preferred = {
        "section-intro",
        "definition",
        "worked-example",
        "question",
        "quiz",
        "recap",
        "summary",
        "outro",
    }
    minimum_gap = 5 * TICKS_PER_SECOND
    result = [0]
    timeline_tick = 0
    for scene in scenes:
        scene_start = timeline_tick
        duration_ticks = _required_int(scene, "durationTicks", minimum=1)
        timeline_tick += duration_ticks
        if scene_start == 0 or str(scene.get("kind", "")) not in preferred:
            continue
        if scene_start - result[-1] >= minimum_gap:
            result.append(scene_start)
        if len(result) >= 12:
            break
    return result


def _safe_name(value: str) -> str:
    result = SAFE_NAME_PATTERN.sub("-", value).strip("-_")
    if not result:
        result = hashlib.sha256(value.encode()).hexdigest()[:16]
    return result[:96]


def _render_visual_customization(
    value: object,
    scenes: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Expand closed visual tokens into scene bindings without accepting paths."""

    default_caption = {
        "position": "auto",
        "style": "soft-panel",
        "sizePercent": 100.0,
        "safeInsetPercent": 6.0,
        "maxLines": 2,
        "textColor": "#FFFFFF",
        "panelColor": "#151827",
        "fontFamily": "Atkinson Hyperlegible Next",
        "fallbackFamilies": ["Arial", "sans-serif"],
    }
    if value is None:
        return [], default_caption
    customization = _required_mapping(value, "visual customization")
    if customization.get("schemaVersion") != 1:
        raise ValueError("Renderer visual customization requires schemaVersion 1")
    assets_value = customization.get("assets", [])
    if not isinstance(assets_value, list):
        raise ValueError("Renderer visual customization assets must be a list")
    presenter = _required_mapping(customization.get("presenter", {}), "visual presenter policy")
    presenter_enabled = presenter.get("enabled") is True
    expanded: list[dict[str, Any]] = []
    for index, item in enumerate(assets_value):
        asset = _required_mapping(item, f"visual customization asset {index}")
        role = str(asset.get("role", "")).strip().casefold()
        if role not in {"background", "presenter-portrait"}:
            raise ValueError(f"Unsupported customized visual role {role!r}")
        # No filesystem locator is part of this record. CAS materialization is
        # performed by _materialize_visual_assets after hash/registration checks.
        if any(key in asset for key in ("path", "url", "uri", "contentBase64")):
            raise ValueError("Visual customization must not contain paths, URLs, or embedded bytes")
        target_scenes = (
            [
                scene
                for scene in scenes
                if str(scene.get("kind"))
                in {"presenter", "presenter-slide", "presenter-with-slide"}
            ]
            if role == "presenter-portrait" and presenter_enabled
            else list(scenes)
            if role == "background"
            else []
        )
        for scene in target_scenes:
            expanded.append(
                {
                    "sceneId": _required_string(scene, "id"),
                    "assetId": _required_string(asset, "assetId"),
                    "artifactHash": _required_string(asset, "artifactHash"),
                    "mediaType": _required_string(asset, "mediaType"),
                    "role": role,
                    "alt": _required_string(asset, "alt"),
                    "fit": str(asset.get("fit", "cover")),
                }
            )
    caption_value = customization.get("captionStyle", default_caption)
    caption = _required_mapping(caption_value, "caption render style")
    result = {
        "position": _enum_value(
            caption.get("position"), {"auto", "top", "lower-third"}, "caption position"
        ),
        "style": _enum_value(
            caption.get("style"), {"soft-panel", "solid-panel", "outline"}, "caption style"
        ),
        "sizePercent": _bounded_number(caption.get("sizePercent"), 60, 160, "caption sizePercent"),
        "safeInsetPercent": _bounded_number(
            caption.get("safeInsetPercent"), 2, 24, "caption safeInsetPercent"
        ),
        "maxLines": _bounded_int(caption.get("maxLines"), 1, 3, "caption maxLines"),
        "textColor": _hex_color(caption.get("textColor"), "caption textColor"),
        "panelColor": _hex_color(caption.get("panelColor"), "caption panelColor"),
        "fontFamily": _font_family(caption.get("fontFamily"), "caption fontFamily"),
        "fallbackFamilies": _fallback_families(caption.get("fallbackFamilies")),
    }
    return expanded, result


def _enum_value(value: object, allowed: set[str], label: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{label} is unsupported")
    return value


def _bounded_number(value: object, minimum: float, maximum: float, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return result


def _bounded_int(value: object, minimum: int, maximum: int, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum or value > maximum:
        raise ValueError(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def _hex_color(value: object, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError(f"{label} must be a six-digit hexadecimal color")
    return value.upper()


def _font_family(value: object, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[\w .'-]{1,120}", value, re.UNICODE):
        raise ValueError(f"{label} contains unsupported characters")
    return value


def _fallback_families(value: object) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 4:
        raise ValueError("caption fallbackFamilies must contain one to four names")
    return [_font_family(item, "caption fallback family") for item in value]


def _visual_asset_role(value: object, scene_kind: str) -> str:
    if value is None:
        if scene_kind in {"presenter", "presenter-slide", "presenter-with-slide"}:
            return "presenter-portrait"
        if scene_kind in {
            "image-focus",
            "image-comparison",
            "document-focus",
            "screen-recording",
        }:
            return "primary"
        return "background"
    normalized = str(value).strip().casefold().replace("_", "-")
    if normalized not in {"background", "primary", "secondary", "presenter-portrait"}:
        raise ValueError(f"Unsupported visual asset role {value!r}")
    return normalized


def _visual_asset_fit(value: object, role: str) -> str:
    if value is None:
        return "cover" if role in {"background", "presenter-portrait"} else "contain"
    normalized = str(value).strip().casefold()
    if normalized not in {"cover", "contain"}:
        raise ValueError("Visual asset fit must be cover or contain")
    return normalized


def _visual_asset_alt(asset: Mapping[str, Any], scene: Mapping[str, Any]) -> str:
    value = asset.get("alt", scene.get("accessibilityDescription", scene.get("content", {})))
    if isinstance(value, Mapping):
        value = scene.get("id", "Tutorial visual")
    if not isinstance(value, str) or not value.strip():
        value = f"Visual for {_required_string(scene, 'id')}"
    normalized = " ".join(value.split())
    return normalized[:1_000]


def _presenter_placement(value: Mapping[str, Any]) -> str:
    """Map the typed presenter-direction vocabulary to renderer placements."""

    direction = value.get("direction")
    raw = value.get("placement")
    if raw is None and isinstance(direction, Mapping):
        raw = direction.get("placement")
    normalized = "picture_in_picture" if raw is None else str(raw).strip().casefold()
    placements = {
        "full": "full",
        "full_frame": "full",
        "picture-in-picture": "picture-in-picture",
        "picture_in_picture": "picture-in-picture",
        "left": "split-left",
        "split-left": "split-left",
        "split_left": "split-left",
        "right": "split-right",
        "split-right": "split-right",
        "split_right": "split-right",
        # The canonical renderer deliberately has no lower-third filter
        # surface. PIP is the fixed caption-safe equivalent.
        "lower_third": "picture-in-picture",
    }
    try:
        return placements[normalized]
    except KeyError as error:
        raise ValueError(f"Unsupported presenter placement {raw!r}") from error


def _presenter_fit(value: Mapping[str, Any]) -> str:
    raw = value.get("fit", "cover")
    if not isinstance(raw, str) or raw not in {"cover", "contain"}:
        raise ValueError("Presenter fit must be cover or contain")
    return raw


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


def _bounded_visual_text(value: object, label: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    if "\x00" in value or any(
        ord(character) < 32 and character not in "\t\n\r" for character in value
    ):
        raise ValueError(f"{label} contains control characters")
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{label} must contain 1 to {maximum} characters")
    if VISUAL_UNSAFE_TEXT_PATTERN.search(normalized) or VISUAL_HTML_PATTERN.search(normalized):
        raise ValueError(f"{label} cannot contain a path, URL, URI, or HTML")
    return normalized


def _visual_identifier(value: object, label: str) -> str:
    normalized = _bounded_visual_text(value, label, 80)
    if not VISUAL_IDENTIFIER_PATTERN.fullmatch(normalized):
        raise ValueError(f"{label} must be a bounded identifier")
    return normalized


def _visual_number(value: object, label: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if abs(value) > 1_000_000_000:
        raise ValueError(f"{label} is outside the supported visual-data range")
    return value


def _visual_information_unit(value: object, index: int) -> dict[str, Any]:
    unit = _required_mapping(value, f"visualBeat information unit {index}")
    keys = set(unit)
    forbidden = keys & VISUAL_FORBIDDEN_PAYLOAD_KEYS
    if forbidden:
        raise ValueError(
            "visualBeat information units cannot contain executable or locator fields: "
            + ", ".join(sorted(forbidden))
        )
    unknown = keys - VISUAL_INFORMATION_UNIT_KEYS
    if unknown:
        raise ValueError(
            "visualBeat information unit contains unsupported fields: "
            + ", ".join(sorted(str(key) for key in unknown))
        )
    normalized: dict[str, Any] = {
        "id": _visual_identifier(unit.get("id"), f"visualBeat information unit {index} id"),
        "role": _visual_identifier(unit.get("role"), f"visualBeat information unit {index} role"),
    }
    for key in ("text", "label", "relation"):
        if key in unit:
            normalized[key] = _bounded_visual_text(
                unit[key], f"visualBeat information unit {index} {key}", 180
            )
    for key in ("value", "low", "middle", "high"):
        if key not in unit:
            continue
        raw_value = unit[key]
        normalized[key] = (
            _bounded_visual_text(raw_value, f"visualBeat information unit {index} {key}", 120)
            if isinstance(raw_value, str)
            else _visual_number(raw_value, f"visualBeat information unit {index} {key}")
        )
    if "values" in unit:
        raw_values = unit["values"]
        if not isinstance(raw_values, list) or not 1 <= len(raw_values) <= 32:
            raise ValueError("visualBeat information-unit values must contain 1 to 32 entries")
        normalized_values: list[str | int | float] = []
        for value_index, raw_value in enumerate(raw_values):
            normalized_values.append(
                _bounded_visual_text(
                    raw_value,
                    f"visualBeat information unit {index} value {value_index}",
                    120,
                )
                if isinstance(raw_value, str)
                else _visual_number(
                    raw_value, f"visualBeat information unit {index} value {value_index}"
                )
            )
        normalized["values"] = normalized_values
    if len(normalized) == 2:
        raise ValueError(f"visualBeat information unit {index} has no display data")
    return normalized


def _visual_text_roles(value: object) -> dict[str, str]:
    roles = _required_mapping(value, "visualBeat textRoles")
    if not 1 <= len(roles) <= 8:
        raise ValueError("visualBeat textRoles must contain 1 to 8 entries")
    forbidden = set(roles) & VISUAL_FORBIDDEN_PAYLOAD_KEYS
    if forbidden:
        raise ValueError(
            "visualBeat textRoles cannot contain executable or locator fields: "
            + ", ".join(sorted(forbidden))
        )
    unknown = set(roles) - VISUAL_TEXT_ROLE_KEYS
    if unknown:
        raise ValueError(
            "visualBeat textRoles contains unsupported roles: "
            + ", ".join(sorted(str(key) for key in unknown))
        )
    return {
        str(key): _bounded_visual_text(value, f"visualBeat text role {key}", 120)
        for key, value in roles.items()
    }


def _visual_avoid_region(value: object, index: int) -> str | dict[str, Any]:
    if isinstance(value, str):
        return _visual_identifier(value, f"visualBeat avoid region {index}")
    region = _required_mapping(value, f"visualBeat avoid region {index}")
    unknown = set(region) - VISUAL_AVOID_REGION_KEYS
    if unknown:
        raise ValueError(
            "visualBeat avoid region contains unsupported fields: "
            + ", ".join(sorted(str(key) for key in unknown))
        )
    role = str(region.get("role", ""))
    if role not in VISUAL_AVOID_REGION_ROLES:
        raise ValueError(f"visualBeat avoid region {index} has unsupported role {role!r}")
    priority = str(region.get("priority", ""))
    if priority not in {"required", "preferred"}:
        raise ValueError(f"visualBeat avoid region {index} has unsupported priority")
    normalized: dict[str, Any] = {
        "id": _visual_identifier(region.get("id"), f"visualBeat avoid region {index} id"),
        "role": role,
        "priority": priority,
    }
    for key in ("x", "y", "width", "height"):
        coordinate = _visual_number(region.get(key), f"visualBeat avoid region {index} {key}")
        if not 0 <= coordinate <= 1:
            raise ValueError(f"visualBeat avoid region {index} {key} must be normalized")
        normalized[key] = coordinate
    if normalized["width"] <= 0 or normalized["height"] <= 0:
        raise ValueError(f"visualBeat avoid region {index} must have positive dimensions")
    if normalized["x"] + normalized["width"] > 1 or normalized["y"] + normalized["height"] > 1:
        raise ValueError(f"visualBeat avoid region {index} exceeds the target frame")
    return normalized


def _authored_visual_beat(value: object) -> dict[str, Any]:
    beat = _required_mapping(value, "visualBeat")
    allowed_keys = {
        "schemaVersion",
        "semanticIntent",
        "compositionFamily",
        "focalAnchor",
        "continuityKey",
        "informationUnits",
        "visualMetaphor",
        "attentionCue",
        "motionIntent",
        "textRoles",
        "avoidRegions",
    }
    forbidden = set(beat) & VISUAL_FORBIDDEN_PAYLOAD_KEYS
    if forbidden:
        raise ValueError(
            "visualBeat cannot contain executable or locator fields: "
            + ", ".join(sorted(forbidden))
        )
    unknown = set(beat) - allowed_keys
    if unknown:
        raise ValueError(
            "visualBeat contains unsupported fields: "
            + ", ".join(sorted(str(key) for key in unknown))
        )
    schema_version = beat.get("schemaVersion")
    if isinstance(schema_version, bool) or schema_version != 1:
        raise ValueError("visualBeat requires schemaVersion 1")
    semantic_intent = str(beat.get("semanticIntent", ""))
    if semantic_intent not in VISUAL_SEMANTIC_INTENTS:
        raise ValueError(f"Unsupported visualBeat semanticIntent {semantic_intent!r}")
    composition_family = str(beat.get("compositionFamily", ""))
    if composition_family not in VISUAL_COMPOSITION_FAMILIES:
        raise ValueError(f"Unsupported visualBeat compositionFamily {composition_family!r}")
    information_units = beat.get("informationUnits")
    if not isinstance(information_units, list) or not 1 <= len(information_units) <= 8:
        raise ValueError("visualBeat informationUnits must contain 1 to 8 entries")
    motion_intent = beat.get("motionIntent")
    if isinstance(motion_intent, str):
        raw_motion_intents = [motion_intent]
    elif isinstance(motion_intent, list) and 1 <= len(motion_intent) <= 4:
        raw_motion_intents = motion_intent
    else:
        raise ValueError("visualBeat motionIntent must contain 1 to 4 intents")
    normalized_motion: list[str] = []
    for raw_intent in raw_motion_intents:
        intent = str(raw_intent)
        if intent not in VISUAL_MOTION_INTENTS:
            raise ValueError(f"Unsupported visualBeat motion intent {intent!r}")
        if intent not in normalized_motion:
            normalized_motion.append(intent)
    avoid_regions = beat.get("avoidRegions", [])
    if not isinstance(avoid_regions, list) or len(avoid_regions) > 8:
        raise ValueError("visualBeat avoidRegions must contain at most 8 entries")
    result: dict[str, Any] = {
        "schemaVersion": 1,
        "semanticIntent": semantic_intent,
        "compositionFamily": composition_family,
        "focalAnchor": _visual_identifier(beat.get("focalAnchor"), "visualBeat focalAnchor"),
        "continuityKey": _visual_identifier(beat.get("continuityKey"), "visualBeat continuityKey"),
        "informationUnits": [
            _visual_information_unit(unit, index) for index, unit in enumerate(information_units)
        ],
        "attentionCue": _visual_identifier(beat.get("attentionCue"), "visualBeat attentionCue"),
        "motionIntent": normalized_motion,
        "textRoles": _visual_text_roles(beat.get("textRoles")),
        "avoidRegions": [
            _visual_avoid_region(region, index) for index, region in enumerate(avoid_regions)
        ],
    }
    if "visualMetaphor" in beat:
        result["visualMetaphor"] = _bounded_visual_text(
            beat["visualMetaphor"], "visualBeat visualMetaphor", 240
        )
    return result


def _on_screen_text(value: object) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= 8:
        raise ValueError("onScreenText must contain 1 to 8 concise labels")
    result: list[str] = []
    seen: set[str] = set()
    total_characters = 0
    for index, raw_text in enumerate(value):
        label = _bounded_visual_text(raw_text, f"onScreenText item {index}", 120)
        total_characters += len(label)
        if total_characters > 640:
            raise ValueError("onScreenText exceeds the 640-character scene budget")
        identity = label.casefold()
        if identity in seen:
            continue
        seen.add(identity)
        result.append(label)
    if not result:
        raise ValueError("onScreenText must contain at least one unique label")
    return result


def _scene_content(scene: Mapping[str, Any], kind: str) -> dict[str, Any]:
    title = _required_string(scene, "title")
    narration = str(scene.get("narration", "")).strip()
    visual_intent = str(scene.get("visualIntent", "")).strip()
    sentence_items = [
        part.strip()
        for part in re.split(r"(?<=[.!?])\s+", narration)
        if part.strip() and part.strip() != title
    ][:5]
    authored_on_screen_text = (
        _on_screen_text(scene["onScreenText"]) if "onScreenText" in scene else None
    )
    authored_visual_beat = (
        _authored_visual_beat(scene["visualBeat"]) if "visualBeat" in scene else None
    )
    if authored_on_screen_text is not None or authored_visual_beat is not None:
        title = _bounded_visual_text(title, "authored scene title", 240)
        if visual_intent:
            visual_intent = _bounded_visual_text(visual_intent, "authored scene visualIntent", 500)
    text_roles = (
        authored_visual_beat.get("textRoles", {}) if authored_visual_beat is not None else {}
    )
    content: dict[str, Any] = {
        "eyebrow": text_roles.get("eyebrow", kind.replace("-", " ").upper()),
        "title": title,
        # Authored display labels supersede narration as frame copy. Narration
        # remains in the audio/caption ledger and visualIntent remains a
        # bounded non-executable direction for scene compilation.
        "body": visual_intent or (None if authored_on_screen_text else narration or None),
        "accent": "#5658E8",
        "items": authored_on_screen_text or sentence_items,
    }
    if authored_on_screen_text is not None:
        content["onScreenText"] = authored_on_screen_text
    if authored_visual_beat is not None:
        content["visualBeat"] = authored_visual_beat
    return content


def _scene_captions(cues: list[object], scene_id: str, duration_ticks: int) -> list[dict[str, Any]]:
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


def _caption_delivery_mode(value: object) -> str:
    if not isinstance(value, str) or value not in SUPPORTED_CAPTION_DELIVERY_MODES:
        raise ValueError("captionDeliveryMode must be sidecar, embedded, burned, or both")
    return value


def _caption_language(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Caption locale must be a BCP-47 language tag")
    aliases = {"English": "en", "Spanish": "es", "Hindi": "hi"}
    selected = aliases.get(value, value).replace("_", "-")
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", selected):
        raise ValueError(f"Caption locale is not a bounded BCP-47 tag: {value!r}")
    return selected


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
    if (
        not isinstance(probe.get("durationSeconds"), (int, float))
        or float(probe["durationSeconds"]) <= 0
    ):
        raise RendererOutputError("Renderer probe duration is invalid")
    caption_delivery = _required_mapping(output.get("captionDelivery"), "renderer caption delivery")
    has_soft_track = bool(caption_delivery.get("embeddedSoftTrack"))
    caption_codec = probe.get("captionCodec")
    if has_soft_track and caption_codec in {None, "", "none", "unknown"}:
        raise RendererOutputError("Renderer probe is missing the requested soft caption track")
    if not has_soft_track and caption_codec != "none":
        raise RendererOutputError("Renderer clean master unexpectedly contains captions")


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
    caption_delivery = result.get("captionDelivery")
    if isinstance(caption_delivery, dict):
        sidecars = caption_delivery.get("sidecars")
        if isinstance(sidecars, dict):
            for name in ("vtt", "srt", "ledger"):
                if isinstance(sidecars.get(name), str):
                    sidecars[name] = Path(sidecars[name]).name
    return cast(dict[str, Any], result)


def _render_metrics(output: Mapping[str, Any]) -> dict[str, Any]:
    probe = _required_mapping(output.get("probe"), "renderer probe")
    qa = _required_mapping(output.get("qaMetrics"), "renderer QA metrics")
    caption_delivery = _required_mapping(output.get("captionDelivery"), "renderer caption delivery")

    def finite(name: str) -> float:
        value = qa.get(name)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
        ):
            raise RendererOutputError(f"Renderer QA metric {name} is not finite")
        return float(value)

    if qa.get("audioIsSilent") is not False:
        raise RendererOutputError("Renderer delivery audio is silent")
    metrics: dict[str, Any] = {
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
        "captionDeliveryMode": _required_string(caption_delivery, "mode"),
        "captionLanguage": _required_string(caption_delivery, "language"),
        "captionCueCount": _required_int(caption_delivery, "cueCount", minimum=0),
        "captionsBurnedIntoVideo": bool(caption_delivery.get("burnedIntoVideo")),
        "captionsEmbeddedSoftTrack": bool(caption_delivery.get("embeddedSoftTrack")),
        "colorTagStatus": str(probe.get("colorTagStatus", "unknown")),
        "width": _required_int(probe, "width", minimum=1),
        "height": _required_int(probe, "height", minimum=1),
        "frameRate": str(probe.get("frameRate", "unknown")),
        "blankFrames": 0,
        "captionCollisions": 0,
        "integratedLufs": finite("integratedLufs"),
        "truePeakDbtp": finite("truePeakDbtp"),
        "clippedSamples": _required_int(qa, "clippedSamples", minimum=0),
        "decodedSamplesPerChannel": _required_int(qa, "decodedSamplesPerChannel", minimum=1),
        "measurementSource": _required_string(qa, "measurementSource"),
    }
    for name in ("avDriftSeconds", "avDriftFrames"):
        if qa.get(name) is not None:
            metrics[name] = finite(name)
    return metrics


def _read_json_object(path: Path, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RendererRuntimeError(f"Could not read {label}: {error}") from error
    if not isinstance(value, dict):
        raise RendererRuntimeError(f"{label} must contain a JSON object")
    return cast(Mapping[str, Any], value)
