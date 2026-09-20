"""SoulX-FlashHead Pro adapter for the exact-hash presenter worker.

The broker verifies the source and model ledger before importing this module.
This adapter calls the pinned upstream inference API directly, limits the video
to the narration frame count, and sends raw RGB frames only to the broker's
probed H.264 encoder. Importing this file alone does not load Torch or models.
"""

from __future__ import annotations

import importlib
import json
import math
import os
import random
import subprocess
import sys
from collections import deque
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any

ENCODER_ARGUMENTS = {
    "h264_nvenc": ["-c:v", "h264_nvenc"],
    "h264_qsv": ["-c:v", "h264_qsv"],
    "h264_mf": ["-c:v", "h264_mf", "-hw_encoding", "1"],
    "libx264": ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
}
REQUIRED_SOURCE_PATHS = (
    "flash_head/inference.py",
    "flash_head/configs/infer_params.yaml",
    "flash_head/audio_analysis/wav2vec2.py",
    "flash_head/src/distributed/usp_device.py",
    "flash_head/src/modules/flash_head_model.py",
    "flash_head/src/pipeline/flash_head_pipeline.py",
    "flash_head/utils/utils.py",
)


def _path_key(path: str | Path, *, strict: bool) -> str:
    value = str(Path(path).resolve(strict=strict))
    if os.name == "nt":
        if value.startswith("\\\\?\\UNC\\"):
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\"):
            value = value[4:]
    return os.path.normcase(value)


def _same_path(left: str | Path, right: str | Path, *, strict: bool = True) -> bool:
    return _path_key(left, strict=strict) == _path_key(right, strict=strict)


def _inside(path: str | Path, root: Path) -> Path:
    candidate = Path(path)
    if candidate.is_symlink():
        raise ValueError("SoulX output cannot be a symbolic link")
    resolved = candidate.resolve()
    Path(_path_key(resolved, strict=False)).relative_to(Path(_path_key(root, strict=True)))
    return resolved


def _manifest_paths(path: Path, label: str) -> tuple[Path, frozenset[str]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError(f"{label} has an invalid schema")
    root_value = value.get("root")
    entries = value.get("files")
    if not isinstance(root_value, str) or not isinstance(entries, list) or not entries:
        raise ValueError(f"{label} is incomplete")
    root = Path(root_value).resolve(strict=True)
    paths: set[str] = set()
    for index, item in enumerate(entries):
        if not isinstance(item, dict) or not isinstance(item.get("relativePath"), str):
            raise ValueError(f"{label} entry {index} is invalid")
        relative = Path(item["relativePath"])
        if relative.is_absolute() or relative.drive or relative.root or ".." in relative.parts:
            raise ValueError(f"{label} entry {index} escapes its root")
        candidate = (root / relative).resolve(strict=True)
        Path(_path_key(candidate, strict=True)).relative_to(Path(_path_key(root, strict=True)))
        paths.add(_path_key(candidate, strict=True))
    return root, frozenset(paths)


def _require_manifested(path: str | Path, manifest_paths: frozenset[str], label: str) -> None:
    try:
        pinned = _path_key(path, strict=True) in manifest_paths
    except OSError:
        pinned = False
    if not pinned:
        raise ValueError(f"{label} is not pinned by its verified runtime manifest")


def _job_workspace(job: Mapping[str, Any], output: Path) -> Path:
    value = job.get("workspace")
    if not isinstance(value, Mapping) or not isinstance(value.get("path"), str):
        raise ValueError("SoulX job has no brokered attempt workspace")
    workspace_path = Path(value["path"])
    if workspace_path.is_symlink() or not workspace_path.is_dir():
        raise ValueError("SoulX brokered workspace must be an existing regular directory")
    workspace = _inside(workspace_path, output.parent.parent)
    if _same_path(workspace, output.parent):
        raise ValueError("SoulX workspace must be separate from the delivery directory")
    return workspace


def _encoder_command(
    encoding: Mapping[str, Any],
    width: int,
    height: int,
    fps: int,
    output: Path,
) -> list[str]:
    arguments = encoding.get("codecArguments")
    encoder = encoding.get("encoder")
    if (
        encoding.get("policy") != "alystria-presenter-h264-v1"
        or encoding.get("pixelFormat") != "yuv420p"
        or encoding.get("audioEncoder") != "aac"
        or not isinstance(encoder, str)
        or encoder not in ENCODER_ARGUMENTS
        or not isinstance(arguments, list)
        or not all(isinstance(item, str) for item in arguments)
        or arguments != ENCODER_ARGUMENTS[encoder]
        or (
            encoder == "libx264"
            and (
                not isinstance(encoding.get("gplRuntimePackId"), str)
                or not encoding["gplRuntimePackId"]
                or not isinstance(encoding.get("gplConsentId"), str)
                or not encoding["gplConsentId"]
            )
        )
        or min(width, height, fps) <= 0
        or width % 2
        or height % 2
    ):
        raise ValueError("SoulX requires a valid brokered H.264 encoder selection")
    return [
        str(encoding["ffmpegPath"]),
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        f"{width}x{height}",
        "-framerate",
        str(fps),
        "-i",
        "pipe:0",
        "-an",
        *arguments,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output),
    ]


def _target_frame_count(sample_count: int, sample_rate: int, fps: int) -> int:
    if min(sample_count, sample_rate, fps) <= 0:
        raise ValueError("SoulX narration must contain positive-duration audio")
    return (sample_count * fps + sample_rate - 1) // sample_rate


def _trimmed_frames(chunks: Iterable[Any], target_frames: int) -> Iterable[Any]:
    """Yield exactly target_frames without retaining the whole animation in RAM."""

    emitted = 0
    for chunk in chunks:
        for frame in chunk:
            if emitted == target_frames:
                return
            emitted += 1
            yield frame
    if emitted != target_frames:
        raise RuntimeError(
            f"SoulX produced {emitted} frames, fewer than the required {target_frames}"
        )


def _write_video_frames(
    frames: Iterable[Any],
    *,
    encoding: Mapping[str, Any],
    width: int,
    height: int,
    fps: int,
    output: Path,
) -> None:
    import numpy as np

    command = _encoder_command(encoding, width, height, fps, output)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    log_path = output.with_suffix(".encode.log")
    with log_path.open("wb") as diagnostic:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=diagnostic,
            creationflags=creationflags,
        )
        try:
            if process.stdin is None:  # pragma: no cover - subprocess contract
                raise RuntimeError("SoulX encoder has no input pipe")
            frame_count = 0
            for raw_frame in frames:
                frame = np.asarray(raw_frame)
                if frame.shape != (height, width, 3):
                    raise ValueError("SoulX changed frame dimensions during encoding")
                if not np.isfinite(frame).all():
                    raise ValueError("SoulX produced non-finite frame pixels")
                frame = np.rint(frame).clip(0, 255).astype(np.uint8)
                process.stdin.write(np.ascontiguousarray(frame).tobytes())
                frame_count += 1
            if frame_count == 0:
                raise RuntimeError("SoulX produced no animation frames")
            process.stdin.close()
            if process.wait(timeout=600) != 0:
                raise RuntimeError("SoulX frame encoding failed")
        except BaseException:
            process.kill()
            process.wait(timeout=15)
            raise


def _mux_audio(
    *,
    encoding: Mapping[str, Any],
    video: Path,
    audio: Path,
    duration_seconds: float,
    output: Path,
) -> None:
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("SoulX narration duration is invalid")
    command = [
        str(encoding["ffmpegPath"]),
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-t",
        f"{duration_seconds:.9f}",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output),
    ]
    completed = subprocess.run(
        command,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=300,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace")[-4_000:]
        raise RuntimeError(f"SoulX audio mux failed ({completed.returncode}): {detail}")


def _generated_chunks(
    *,
    audio_samples: Any,
    pipeline: Any,
    infer_params: Mapping[str, Any],
    get_audio_embedding: Callable[..., Any],
    run_pipeline: Callable[..., Any],
    emit_progress: Callable[..., None],
) -> Iterable[Any]:
    import numpy as np

    sample_rate = int(infer_params["sample_rate"])
    fps = int(infer_params["tgt_fps"])
    frame_num = int(infer_params["frame_num"])
    motion_frames = int(infer_params["motion_frames_num"])
    cached_audio_duration = int(infer_params["cached_audio_duration"])
    slice_frames = frame_num - motion_frames
    if (
        sample_rate <= 0
        or fps <= 0
        or not 0 < motion_frames < frame_num
        or cached_audio_duration <= 0
        or slice_frames * sample_rate % fps
    ):
        raise ValueError("SoulX inference parameters are incompatible with exact frame timing")
    samples_per_slice = slice_frames * sample_rate // fps
    chunk_count = (len(audio_samples) + samples_per_slice - 1) // samples_per_slice
    padded = np.pad(
        np.asarray(audio_samples, dtype=np.float32),
        (0, chunk_count * samples_per_slice - len(audio_samples)),
    ).reshape(chunk_count, samples_per_slice)
    cached_samples = sample_rate * cached_audio_duration
    audio_frames = deque([0.0] * cached_samples, maxlen=cached_samples)
    audio_end_frame = cached_audio_duration * fps
    audio_start_frame = audio_end_frame - frame_num
    if audio_start_frame < 0:
        raise ValueError("SoulX audio cache is shorter than its inference window")

    for index, audio_slice in enumerate(padded):
        audio_frames.extend(audio_slice.tolist())
        audio_embedding = get_audio_embedding(
            pipeline,
            np.asarray(audio_frames, dtype=np.float32),
            audio_start_frame,
            audio_end_frame,
        )
        video = run_pipeline(pipeline, audio_embedding)[motion_frames:]
        if hasattr(video, "detach"):
            video = video.detach()
        if hasattr(video, "cpu"):
            video = video.cpu()
        if hasattr(video, "numpy"):
            video = video.numpy()
        frames = np.asarray(video)
        if frames.ndim != 4 or frames.shape[0] != slice_frames:
            raise RuntimeError("SoulX returned an unexpected animation chunk")
        emit_progress(
            "inference",
            0.15 + 0.65 * ((index + 1) / chunk_count),
            f"Animated narration chunk {index + 1} of {chunk_count}",
        )
        yield frames


def _validate_weight_layout(files: Mapping[str, Path]) -> tuple[Path, Path]:
    flashhead_config = files["flashhead-config"]
    flashhead_root = flashhead_config.parent.parent
    expected = {
        "flashhead-config": flashhead_root / "Model_Pro" / "config.json",
        "flashhead-weights": flashhead_root / "Model_Pro" / "diffusion_pytorch_model.safetensors",
        "vae-weights": flashhead_root / "VAE_Wan" / "Wan2.1_VAE.pth",
    }
    audio_root = files["audio-feature-config"].parent
    expected.update(
        {
            "audio-feature-config": audio_root / "config.json",
            "audio-feature-preprocessor": audio_root / "preprocessor_config.json",
            "audio-feature-weights": audio_root / "model.safetensors",
        }
    )
    for role, path in expected.items():
        if not _same_path(files[role], path):
            raise ValueError(f"SoulX {role} does not identify the reviewed {path.name}")
    return flashhead_root, audio_root


def run_presenter_job(job: dict[str, Any], emit_progress: Callable[..., None]) -> int:
    if job.get("model") != "soulx-flashhead-pro":
        raise ValueError("SoulX adapter requires the explicit Pro model")
    files = {item["role"]: Path(item["path"]) for item in job["workerContract"]["files"]}
    runtime_root, source_paths = _manifest_paths(
        files["runtime-source-manifest"], "SoulX source manifest"
    )
    for relative in REQUIRED_SOURCE_PATHS:
        _require_manifested(runtime_root / relative, source_paths, f"SoulX {relative}")
    checkpoint_root, audio_root = _validate_weight_layout(files)

    output = Path(job["output"]["path"]).resolve()
    workspace = _job_workspace(job, output)
    work = workspace / "soulx-flashhead"
    work.mkdir(exist_ok=False)
    silent_video = work / "frames.mp4"
    portrait = Path(job["inputs"]["portrait"]["path"]).resolve(strict=True)
    audio = Path(job["inputs"]["audio"]["path"]).resolve(strict=True)
    encoding = job["encoding"]
    previous_cwd = Path.cwd()
    sys.path.insert(0, str(runtime_root))
    try:
        os.chdir(runtime_root)
        import librosa
        import numpy as np
        import torch

        seed = int(job["seed"])
        random.seed(seed)
        np.random.seed(seed % (2**32))
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        inference = importlib.import_module("flash_head.inference")
        emit_progress("model-loading", 0.12, "Loading pinned SoulX-FlashHead Pro weights")
        pipeline = inference.get_pipeline(
            world_size=1,
            ckpt_dir=str(checkpoint_root),
            wav2vec_dir=str(audio_root),
            model_type="pro",
        )
        inference.get_base_data(
            pipeline,
            cond_image_path_or_dir=str(portrait),
            base_seed=seed,
            use_face_crop=False,
        )
        infer_params = inference.get_infer_params()
        sample_rate = int(infer_params["sample_rate"])
        fps = int(infer_params["tgt_fps"])
        width = int(infer_params["width"])
        height = int(infer_params["height"])
        if min(sample_rate, fps, width, height) <= 0 or width % 2 or height % 2:
            raise ValueError("SoulX inference dimensions or timing are invalid")
        audio_samples, loaded_rate = librosa.load(str(audio), sr=sample_rate, mono=True)
        if loaded_rate != sample_rate:
            raise RuntimeError("SoulX audio loader returned an unexpected sample rate")
        target_frames = _target_frame_count(len(audio_samples), sample_rate, fps)
        duration_seconds = len(audio_samples) / sample_rate
        emit_progress("inference", 0.15, "Animating the character from the narration")
        chunks = _generated_chunks(
            audio_samples=audio_samples,
            pipeline=pipeline,
            infer_params=infer_params,
            get_audio_embedding=inference.get_audio_embedding,
            run_pipeline=inference.run_pipeline,
            emit_progress=emit_progress,
        )
        _write_video_frames(
            _trimmed_frames(chunks, target_frames),
            encoding=encoding,
            width=width,
            height=height,
            fps=fps,
            output=silent_video,
        )
        emit_progress("encoding", 0.9, "Encoded exact-duration presenter frames")
        _mux_audio(
            encoding=encoding,
            video=silent_video,
            audio=audio,
            duration_seconds=duration_seconds,
            output=output,
        )
        emit_progress("encoding", 0.96, "Muxed the verified narration track")
        if not output.is_file() or output.stat().st_size < 1_024:
            raise RuntimeError("SoulX produced no playable delivery")
        return 0
    finally:
        os.chdir(previous_cwd)
        sys.path.remove(str(runtime_root))
