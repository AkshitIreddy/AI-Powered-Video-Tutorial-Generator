"""Alystria adapter for the exact-hash MuseTalk 1.5 inference pack.

The upstream entrypoint is imported from the verified source ledger. Its
``os.system`` FFmpeg calls are intercepted and replaced with fixed argv calls
using the application's already-probed encoder. Still portraits require two
calls; an animated portrait requires one additional, narrowly pinned frame
extraction call. No shell command is executed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
from array import array
from collections.abc import Callable
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, NoReturn

ALLOWED_CODEC_ARGUMENTS = {
    "h264_nvenc": ("-c:v", "h264_nvenc"),
    "h264_qsv": ("-c:v", "h264_qsv"),
    "h264_mf": ("-c:v", "h264_mf", "-hw_encoding", "1"),
    "libx264": ("-c:v", "libx264", "-preset", "medium", "-crf", "18"),
}
VIDEO_SUFFIXES = frozenset({".avi", ".mkv", ".mov", ".mp4", ".webm"})


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _library_path(path: Path) -> str:
    """Return the same Windows path without a prefix some ML libs misjoin."""

    value = str(path)
    if os.name != "nt":
        return value
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    if value.startswith("\\\\?\\"):
        return value[4:]
    return value


def _normalize_portrait_for_upstream(portrait: Path, workspace: Path) -> Path:
    """Convert verified WebP inputs for MuseTalk's extension-gated loader.

    The app's asset pipeline intentionally supports WebP, while the pinned
    MuseTalk 1.5 entrypoint only recognizes JPEG and PNG image suffixes before
    it asks OpenCV to decode the file. Decode and re-encode inside the isolated
    attempt workspace so the immutable CAS input and its provenance remain
    untouched.
    """

    if portrait.suffix.casefold() != ".webp":
        return portrait
    import cv2

    image = cv2.imread(_library_path(portrait), cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0:
        _fail("Verified WebP presenter portrait could not be decoded")
    normalized = workspace / "portrait-normalized.png"
    if normalized.exists() or not cv2.imwrite(_library_path(normalized), image):
        _fail("WebP presenter portrait could not be normalized to PNG")
    if not normalized.is_file() or normalized.stat().st_size <= 0:
        _fail("Normalized presenter portrait is missing or empty")
    return normalized


def _fixed_argv_matches(
    actual: tuple[str, ...], expected: tuple[str, ...], *, path_indices: set[int]
) -> bool:
    if len(actual) != len(expected):
        return False
    for index, (actual_value, expected_value) in enumerate(zip(actual, expected, strict=True)):
        if index in path_indices:
            if os.path.normcase(os.path.normpath(actual_value)) != os.path.normcase(
                os.path.normpath(expected_value)
            ):
                return False
        elif actual_value != expected_value:
            return False
    return True


def _upstream_output_paths(
    result_root: Path, portrait_path: str, audio_path: str
) -> tuple[Path, Path, Path, Path]:
    """Mirror MuseTalk's basename-derived output contract exactly.

    WebP portraits are normalized to ``portrait-normalized.png`` before the
    pinned upstream entrypoint sees them.  Deriving these paths from the
    effective inputs keeps the shell interception contract aligned with that
    compatibility conversion instead of silently assuming ``portrait.webp``.
    """

    version_root = result_root / "v15"
    portrait_stem = Path(portrait_path).stem
    audio_stem = Path(audio_path).stem
    output_stem = f"{portrait_stem}_{audio_stem}"
    return (
        version_root,
        version_root / f"temp_{output_stem}.mp4",
        version_root / "presenter.mp4",
        version_root / output_stem / "%08d.png",
    )


def _contract_files(job: dict[str, Any]) -> dict[str, Path]:
    contract = job.get("workerContract")
    if not isinstance(contract, dict) or not isinstance(contract.get("files"), list):
        _fail("MuseTalk contract files are missing")
    values: dict[str, Path] = {}
    for item in contract["files"]:
        if not isinstance(item, dict):
            _fail("MuseTalk contract file is invalid")
        role = item.get("role")
        path = item.get("path")
        if not isinstance(role, str) or not isinstance(path, str):
            _fail("MuseTalk contract role or path is invalid")
        values[role] = Path(path).resolve(strict=True)
    return values


def _load_inference(path: Path, source_root: Path) -> ModuleType:
    sys.path.insert(0, str(source_root))
    spec = importlib.util.spec_from_file_location("alystria_pinned_musetalk_inference", path)
    if spec is None or spec.loader is None:
        _fail("Could not load pinned MuseTalk inference entrypoint")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_preprocessing_with_pinned_paths(
    *, source_root: Path, pose_weights: Path
) -> None:
    """Preload one upstream module with its two cwd-relative pins resolved.

    The verified MuseTalk revision places code under ``source/musetalk`` and
    weights under the sibling ``models`` directory, yet preprocessing declares
    both paths relative to one cwd.  Rewrite exactly those two declarations in
    memory after the worker has verified the complete source ledger.  No
    installed file is changed and no link-based runtime view is introduced.
    """

    module_name = "musetalk.utils.preprocessing"
    preprocessing = (source_root / "musetalk/utils/preprocessing.py").resolve(strict=True)
    preprocessing.relative_to(source_root)
    pose_config = (
        source_root
        / "musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py"
    ).resolve(strict=True)
    pose_config.relative_to(source_root)
    source = preprocessing.read_text(encoding="utf-8")
    replacements = {
        "config_file = './musetalk/utils/dwpose/rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py'": (
            f"config_file = {str(pose_config)!r}"
        ),
        "checkpoint_file = './models/dwpose/dw-ll_ucoco_384.pth'": (
            f"checkpoint_file = {str(pose_weights)!r}"
        ),
    }
    for original, replacement in replacements.items():
        if source.count(original) != 1:
            _fail("MuseTalk preprocessing path contract changed from the pinned revision")
        source = source.replace(original, replacement)

    sys.path.insert(0, str(source_root))
    importlib.import_module("musetalk.utils")
    spec = importlib.util.spec_from_file_location(module_name, preprocessing)
    if spec is None:
        _fail("Could not create the pinned MuseTalk preprocessing module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        exec(compile(source, str(preprocessing), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(module_name, None)
        raise


def _model_pack_root(files: dict[str, Path]) -> Path:
    """Resolve and validate the upstream ``./models`` working layout.

    MuseTalk imports code from its pinned source tree, but its inference module
    resolves weights relative to the current directory.  The source and weight
    packs are siblings, so running from the source root makes verified weights
    look missing even though their exact paths were supplied in the contract.
    """

    expected = {
        "audio-feature-config": Path("whisper/config.json"),
        "audio-feature-preprocessor": Path("whisper/preprocessor_config.json"),
        "audio-feature-weights": Path("whisper/model.safetensors"),
        "face-detection-weights": Path("face-detection/s3fd-619a316812.pth"),
        "face-landmark-weights": Path("dwpose/dw-ll_ucoco_384.pth"),
        "face-parse-weights": Path("face-parse-bisent/79999_iter.pth"),
        "face-resnet-weights": Path("face-parse-bisent/resnet18-5c106cde.pth"),
        "musetalk-config": Path("musetalkV15/musetalk.json"),
        "musetalk-weights": Path("musetalkV15/unet.pth"),
        "vae-config": Path("sd-vae-ft-mse/config.json"),
        "vae-weights": Path("sd-vae-ft-mse/diffusion_pytorch_model.safetensors"),
    }
    config = files["musetalk-config"]
    models_root = config.parent.parent
    if models_root.name.casefold() != "models" or not models_root.is_dir():
        _fail("MuseTalk contract does not provide the pinned upstream models layout")
    for role, relative in expected.items():
        if files.get(role) != (models_root / relative).resolve(strict=True):
            _fail(f"MuseTalk contract role {role} is outside its pinned upstream layout")
    return models_root.parent


def _prime_torch_cache(files: dict[str, Path], workspace: Path) -> None:
    """Install the verified S3FD weight into an attempt-local offline cache."""

    cache_root = workspace / "torch-cache"
    checkpoints = cache_root / "hub" / "checkpoints"
    checkpoints.mkdir(parents=True)
    source = files["face-detection-weights"]
    destination = checkpoints / "s3fd-619a316812.pth"
    shutil.copyfile(source, destination)
    if _sha256(destination) != _sha256(source):
        _fail("Attempt-local S3FD cache copy changed after contract verification")
    os.environ["TORCH_HOME"] = str(cache_root)


def _run(argv: tuple[str, ...], *, cwd: Path) -> None:
    result = subprocess.run(
        argv,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        shell=False,
        timeout=3_600,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-4_096:].decode(errors="replace")
        raise RuntimeError(f"Presenter FFmpeg failed with code {result.returncode}: {detail}")


def _speech_weights_from_pcm(
    pcm: bytes,
    *,
    sample_rate: int = 16_000,
    fps: int = 25,
) -> list[float]:
    """Return a conservative per-video-frame speech envelope.

    MuseTalk can hallucinate open-mouth motion over digital silence. Decode the
    final narration itself and keep the source mouth wherever no speech energy
    exists. A short two-frame transition avoids a visible snap at phrase edges.
    """

    if not pcm or len(pcm) % 2:
        _fail("Decoded presenter narration PCM is missing or malformed")
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":  # pragma: no cover - Windows runtime is little-endian
        samples.byteswap()
    samples_per_frame = sample_rate / fps
    frame_count = max(1, math.ceil(len(samples) / samples_per_frame))
    weights: list[float] = []
    for frame_index in range(frame_count):
        start = round(frame_index * samples_per_frame)
        end = min(len(samples), round((frame_index + 1) * samples_per_frame))
        window = samples[start:end]
        if not window:
            weights.append(0.0)
            continue
        mean_square = sum(float(value) * float(value) for value in window) / len(window)
        dbfs = 20.0 * math.log10(max(math.sqrt(mean_square) / 32768.0, 1e-9))
        # Below -50 dBFS is a true rest frame. Above -35 dBFS is confidently
        # voiced; the interval between them fades rather than toggles.
        weights.append(min(1.0, max(0.0, (dbfs + 50.0) / 15.0)))
    for index in range(1, len(weights)):
        weights[index] = max(weights[index], weights[index - 1] - 0.5)
    for index in range(len(weights) - 2, -1, -1):
        weights[index] = max(weights[index], weights[index + 1] - 0.5)
    return weights


def _decode_speech_weights(
    *,
    ffmpeg: Path,
    audio_path: str,
    workspace: Path,
) -> list[float]:
    result = subprocess.run(
        (
            str(ffmpeg),
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-i",
            audio_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "pipe:1",
        ),
        cwd=workspace,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        shell=False,
        timeout=3_600,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr[-4_096:].decode(errors="replace")
        _fail(f"Presenter narration decode failed with code {result.returncode}: {detail}")
    return _speech_weights_from_pcm(result.stdout)


def _restore_silent_mouth_frames(
    *,
    generated_pattern: Path,
    source_pattern: Path,
    portrait: Path,
    speech_weights: list[float],
) -> int:
    """Blend generated frames back to the verified source during silence."""

    import cv2

    generated_frames = sorted(generated_pattern.parent.glob("*.png"))
    if not generated_frames:
        _fail("MuseTalk produced no frames for silence restoration")
    source_frames = sorted(source_pattern.parent.glob("*.png"))
    static_source = None
    if not source_frames:
        static_source = cv2.imread(_library_path(portrait), cv2.IMREAD_COLOR)
        if static_source is None or static_source.size == 0:
            _fail("Presenter source could not be decoded for silence restoration")
    restored = 0
    for index, generated_path in enumerate(generated_frames):
        weight = speech_weights[min(index, len(speech_weights) - 1)]
        if weight >= 0.999:
            continue
        generated = cv2.imread(_library_path(generated_path), cv2.IMREAD_COLOR)
        source = (
            cv2.imread(
                _library_path(source_frames[index % len(source_frames)]),
                cv2.IMREAD_COLOR,
            )
            if source_frames
            else static_source
        )
        if generated is None or source is None or generated.size == 0 or source.size == 0:
            _fail("Presenter frame could not be decoded for silence restoration")
        if source.shape[:2] != generated.shape[:2]:
            source = cv2.resize(
                source,
                (generated.shape[1], generated.shape[0]),
                interpolation=cv2.INTER_LANCZOS4,
            )
        blended = cv2.addWeighted(generated, weight, source, 1.0 - weight, 0.0)
        if not cv2.imwrite(_library_path(generated_path), blended):
            _fail("Silence-restored presenter frame could not be written")
        restored += 1
    return restored


def _identity_preserving_get_image(
    image: Any,
    face: Any,
    face_box: list[int],
    *,
    upstream_get_image: Callable[..., Any],
    mode: str,
    fp: Any,
) -> Any:
    """Limit MuseTalk replacement pixels to a feathered lip aperture.

    MuseTalk's semantic ``raw`` mask still classifies facial hair as face skin,
    so a conventional lower-face composite can erase moustaches and beards.
    Keep its colour-matched composite only around the moving lips and retain
    the source portrait everywhere else.  The proportions are relative to the
    detected face box and therefore remain resolution independent.
    """

    import cv2
    import numpy as np

    composite = upstream_get_image(image, face, face_box, mode=mode, fp=fp)
    x1, y1, x2, y2 = (int(value) for value in face_box)
    width = max(1, x2 - x1)
    height = max(1, y2 - y1)
    center = (x1 + width // 2, y1 + round(height * 0.715))
    axes = (max(2, round(width * 0.26)), max(2, round(height * 0.075)))
    mask = np.zeros(image.shape[:2], dtype=np.uint8)
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1, lineType=cv2.LINE_AA)
    feather = max(3, round(min(width, height) * 0.018))
    if feather % 2 == 0:
        feather += 1
    mask = cv2.GaussianBlur(mask, (feather, feather), 0)
    alpha = mask.astype(np.float32)[..., None] / 255.0
    restored = (
        composite.astype(np.float32) * alpha
        + image.astype(np.float32) * (1.0 - alpha)
    )
    return np.clip(restored, 0, 255).astype(np.uint8)


def run_presenter_job(
    job: dict[str, Any], emit_progress: Callable[[str, float, str], None]
) -> int:
    files = _contract_files(job)
    inference_path = files["musetalk-inference-entrypoint"]
    model_pack_root = _model_pack_root(files)
    source_manifest = json.loads(files["runtime-source-manifest"].read_text(encoding="utf-8"))
    source_root = Path(str(source_manifest["root"])).resolve(strict=True)
    inputs = job["inputs"]
    output = Path(_library_path(Path(str(job["output"]["path"]))))
    workspace = output.parent.parent / "workspace"
    if not workspace.resolve(strict=True).is_dir():
        _fail("MuseTalk workspace is unavailable")
    portrait = _normalize_portrait_for_upstream(
        Path(str(inputs["portrait"]["path"])).resolve(strict=True), workspace
    )
    portrait_path = _library_path(portrait)
    audio_path = _library_path(Path(str(inputs["audio"]["path"])))
    result_root = workspace / "musetalk-results"
    result_root.mkdir()
    inference_config = workspace / "inference.json"
    inference_config.write_text(
        json.dumps(
            {
                "alystria": {
                    "video_path": portrait_path,
                    "audio_path": audio_path,
                    "result_name": "presenter.mp4",
                }
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    _prime_torch_cache(files, workspace)

    encoding = job["encoding"]
    encoder = str(encoding.get("encoder"))
    codec_arguments = tuple(str(value) for value in encoding.get("codecArguments", []))
    if ALLOWED_CODEC_ARGUMENTS.get(encoder) != codec_arguments:
        _fail("Presenter encoder arguments do not match the allowlisted selection")
    ffmpeg = Path(_library_path(Path(str(encoding["ffmpegPath"]))))
    speech_weights = _decode_speech_weights(
        ffmpeg=ffmpeg,
        audio_path=audio_path,
        workspace=workspace,
    )
    version_root, silent_video, generated_output, frames = _upstream_output_paths(
        result_root, portrait_path, audio_path
    )
    source_frames = version_root / Path(portrait_path).stem / "%08d.png"
    intercepted = 0

    def safe_ffmpeg(argv: Any, **_: Any) -> subprocess.CompletedProcess[bytes]:
        nonlocal intercepted
        if not isinstance(argv, (list, tuple)) or not all(
            isinstance(value, str) for value in argv
        ):
            _fail("MuseTalk attempted an unsupported FFmpeg invocation")
        upstream = tuple(argv)
        intercepted += 1
        if intercepted == 1:
            expected = (
                str(ffmpeg),
                "-y",
                "-v",
                "warning",
                "-r",
                "25",
                "-f",
                "image2",
                "-i",
                str(frames),
                "-vcodec",
                "libx264",
                "-vf",
                "format=yuv420p",
                "-crf",
                "18",
                str(silent_video),
            )
            if not _fixed_argv_matches(upstream, expected, path_indices={0, 9, 16}):
                _fail("MuseTalk image-to-video argv changed from the pinned contract")
            _restore_silent_mouth_frames(
                generated_pattern=frames,
                source_pattern=source_frames,
                portrait=portrait,
                speech_weights=speech_weights,
            )
            emit_progress("encoding", 0.85, "Encoding MuseTalk frames with approved H.264")
            _run(
                (
                    str(ffmpeg),
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    "-v",
                    "warning",
                    "-r",
                    "25",
                    "-f",
                    "image2",
                    "-i",
                    str(frames),
                    *codec_arguments,
                    "-pix_fmt",
                    "yuv420p",
                    str(silent_video),
                ),
                cwd=workspace,
            )
            return subprocess.CompletedProcess(upstream, 0, b"", b"")
        if intercepted == 2:
            expected = (
                str(ffmpeg),
                "-y",
                "-v",
                "warning",
                "-i",
                audio_path,
                "-i",
                str(silent_video),
                str(generated_output),
            )
            if not _fixed_argv_matches(upstream, expected, path_indices={0, 5, 7, 8}):
                _fail("MuseTalk audio-mux argv changed from the pinned contract")
            _run(
                (
                    str(ffmpeg),
                    "-hide_banner",
                    "-nostdin",
                    "-y",
                    "-i",
                    str(silent_video),
                    "-i",
                    audio_path,
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    *codec_arguments,
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    str(generated_output),
                ),
                cwd=workspace,
            )
            return subprocess.CompletedProcess(upstream, 0, b"", b"")
        _fail("MuseTalk attempted an unexpected additional FFmpeg invocation")

    def safe_system(command: str) -> int:
        """Translate only exact pinned upstream shell strings to fixed argv."""

        extraction = (
            f"ffmpeg -v fatal -i {portrait_path} -start_number 0 "
            f"{source_frames.parent}/%08d.png"
        )

        upstream_fps = "25.0" if portrait.suffix.casefold() in VIDEO_SUFFIXES else "25"
        first = (
            f"ffmpeg -y -v warning -r {upstream_fps} -f image2 -i "
            f"{frames.parent}/%08d.png -vcodec libx264 -vf format=yuv420p -crf 18 "
            f"{silent_video.parent}/{silent_video.name}"
        )
        second = (
            f"ffmpeg -y -v warning -i {audio_path} -i "
            f"{silent_video.parent}/{silent_video.name} {generated_output}"
        )
        if command == extraction and portrait.suffix.casefold() in VIDEO_SUFFIXES:
            if not source_frames.parent.resolve(strict=True).is_relative_to(
                result_root.resolve(strict=True)
            ):
                _fail("MuseTalk frame extraction escaped the attempt workspace")
            _run(
                (
                    str(ffmpeg),
                    "-hide_banner",
                    "-nostdin",
                    "-v",
                    "fatal",
                    "-i",
                    portrait_path,
                    "-start_number",
                    "0",
                    str(source_frames),
                ),
                cwd=workspace,
            )
            return 0
        if command == first:
            safe_ffmpeg(
                [
                    str(ffmpeg), "-y", "-v", "warning", "-r", "25", "-f", "image2",
                    "-i", str(frames), "-vcodec", "libx264", "-vf", "format=yuv420p",
                    "-crf", "18", str(silent_video),
                ]
            )
            return 0
        if command == second:
            safe_ffmpeg(
                [
                    str(ffmpeg), "-y", "-v", "warning", "-i", audio_path,
                    "-i", str(silent_video), str(generated_output),
                ]
            )
            return 0
        _fail(
            "MuseTalk attempted an unexpected shell command: "
            f"received={command!r}; extraction={extraction!r}; "
            f"first={first!r}; second={second!r}"
        )

    emit_progress("inference", 0.15, "Running pinned MuseTalk 1.5 inference")
    original_cwd = Path.cwd()
    upstream_failure: str | None = None
    try:
        # Source imports and weight discovery intentionally use different
        # roots: upstream code lives in ``source`` while hard-coded weight
        # paths begin at ``./models`` in the sibling model pack root.
        os.chdir(model_pack_root)
        _load_preprocessing_with_pinned_paths(
            source_root=source_root,
            pose_weights=files["face-landmark-weights"],
        )
        module = _load_inference(inference_path, source_root)
        os_proxy = ModuleType("alystria_pinned_os_proxy")
        os_proxy.__dict__.update(os.__dict__)
        os_proxy.system = safe_system
        module.os = os_proxy
        module.subprocess = SimpleNamespace(run=safe_ffmpeg)
        module.fast_check_ffmpeg = lambda: True
        upstream_get_image = module.get_image
        module.get_image = lambda image, face, face_box, mode="raw", fp=None: (
            _identity_preserving_get_image(
                image,
                face,
                face_box,
                upstream_get_image=upstream_get_image,
                mode=mode,
                fp=fp,
            )
        )

        def upstream_print(*values: object, **kwargs: Any) -> None:
            nonlocal upstream_failure
            message = " ".join(str(value) for value in values)
            if message.startswith("Error occurred during processing:"):
                upstream_failure = message.removeprefix(
                    "Error occurred during processing:"
                ).strip()
            print(*values, **kwargs)

        module.print = upstream_print
        arguments = argparse.Namespace(
            ffmpeg_path=str(ffmpeg.parent),
            gpu_id=int(str(job["gpuLease"]["deviceId"]).split(":")[-1]),
            vae_type=_library_path(files["vae-config"].parent),
            unet_config=_library_path(files["musetalk-config"]),
            unet_model_path=_library_path(files["musetalk-weights"]),
            whisper_dir=_library_path(files["audio-feature-config"].parent),
            inference_config=_library_path(inference_config),
            bbox_shift=0,
            result_dir=_library_path(result_root),
            extra_margin=10,
            fps=25,
            audio_padding_length_left=2,
            audio_padding_length_right=2,
            # The pinned upstream v1.5 default is eight. The previous value of
            # one left most of this 12 GB GPU idle and made a 9.6-second mouth
            # pass take 327.8 seconds in a fresh Windows measurement.
            batch_size=8,
            output_vid_name="presenter.mp4",
            use_saved_coord=False,
            saved_coord=False,
            use_float16=True,
            # MuseTalk's expanded ``jaw`` segmentation deliberately dilates
            # skin across the lower face. That erases identity details the
            # upstream project already calls out (notably moustaches and
            # beard edges). ``raw`` keeps the original semantic face mask, so
            # pixels classified outside the actual talking region survive the
            # composite while the lips remain animated.
            parsing_mode="raw",
            left_cheek_width=90,
            right_cheek_width=90,
            version="v15",
        )
        module.main(arguments)
        image_cleanup_failure = "local variable 'save_dir_full' referenced before assignment"
        cleanup_only_after_delivery = (
            upstream_failure == image_cleanup_failure
            and intercepted == 2
            and generated_output.is_file()
        )
        if upstream_failure is not None and not cleanup_only_after_delivery:
            _fail(f"MuseTalk upstream task failed: {upstream_failure}")
    finally:
        os.chdir(original_cwd)
    if intercepted != 2 or not generated_output.is_file():
        _fail("MuseTalk inference did not complete both brokered FFmpeg stages")
    shutil.move(str(generated_output), output)
    return 0
