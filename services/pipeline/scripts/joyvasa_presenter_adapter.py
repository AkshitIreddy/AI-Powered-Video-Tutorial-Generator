"""JoyVASA adapter for the exact-hash presenter worker.

The installed source manifest owns model code/weights. This adapter selects the
detector-free path, anchors facial animation to the source portrait, and uses
the broker's probed FFmpeg encoder. It is imported after worker verification and
network denial; importing this file alone does not load Torch or any models.
"""

from __future__ import annotations

import dataclasses
import importlib
import json
import os
import pathlib
import random
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

ENCODER_ARGUMENTS = {
    "h264_nvenc": ["-c:v", "h264_nvenc"],
    "h264_qsv": ["-c:v", "h264_qsv"],
    "h264_mf": ["-c:v", "h264_mf", "-hw_encoding", "1"],
    "libx264": ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
}


def _path_key(path: str | Path, *, strict: bool) -> str:
    """Return one comparison spelling for normal and Windows verbatim paths."""

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
        raise ValueError("Presenter output cannot be a symbolic link")
    resolved = candidate.resolve()
    Path(_path_key(resolved, strict=False)).relative_to(
        Path(_path_key(root, strict=True))
    )
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
        raise ValueError("JoyVASA job has no brokered attempt workspace")
    workspace_path = Path(value["path"])
    if workspace_path.is_symlink() or not workspace_path.is_dir():
        raise ValueError("JoyVASA brokered workspace must be an existing regular directory")
    workspace = _inside(workspace_path, output.parent.parent)
    if _same_path(workspace, output.parent):
        raise ValueError("JoyVASA workspace must be separate from the delivery directory")
    return workspace


def _encoder_command(
    encoding: Mapping[str, Any], width: int, height: int, fps: int, output: Path
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
        raise ValueError("JoyVASA requires a valid brokered H.264 encoder selection")
    # libx264 can only arrive through the broker's explicit approved GPL pack.
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


def _face_mask(keypoints: Any, height: int, width: int):
    """A source-anchored facial envelope in LivePortrait's normalized XY space.

    The two eye groups and mouth determine location, scale and tilt, so this
    follows the subject rather than assuming a fixed portrait crop. Everything
    outside the feathered envelope is copied from the original still.
    """
    import numpy as np

    points = np.asarray(keypoints, dtype=np.float32).reshape(21, 3)[:, :2]
    points = (points + 1) * np.array([width, height], dtype=np.float32) / 2
    left, right, mouth = points[11:14].mean(0), points[14:17].mean(0), points[17:21].mean(0)
    eye_center = (left + right) / 2
    eye_distance = float(np.linalg.norm(right - left))
    if not np.isfinite(points).all() or eye_distance < min(height, width) * 0.03:
        raise ValueError("Presenter facial keypoints cannot define a stable face region")
    horizontal = (right - left) / eye_distance
    vertical = np.array([-horizontal[1], horizontal[0]], dtype=np.float32)
    if np.dot(mouth - eye_center, vertical) < 0:
        vertical = -vertical
    mouth_distance = float(np.dot(mouth - eye_center, vertical))
    if mouth_distance < eye_distance * 0.2 or mouth_distance > eye_distance * 3:
        raise ValueError("Presenter facial keypoints have an invalid eye-to-mouth layout")
    center = eye_center + vertical * mouth_distance * 0.55
    yy, xx = np.mgrid[:height, :width]
    delta = np.stack((xx - center[0], yy - center[1]), axis=-1)
    radius = np.sqrt((delta @ horizontal / (eye_distance * 1.15)) ** 2
                     + (delta @ vertical / (mouth_distance * 1.25)) ** 2)
    fade = np.clip((radius - 0.72) / 0.28, 0, 1)
    return ((1 + np.cos(fade * np.pi)) / 2).astype(np.float32)[..., None]


def _media_writers(job: Mapping[str, Any], workspace: Path, emit_progress: Callable[..., None],
                   source_keypoints: dict[str, Any]):
    encoding = job["encoding"]
    audio = Path(job["inputs"]["audio"]["path"]).resolve(strict=True)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    def images2video(images: Sequence[Any], wfp: str, **kwargs: Any) -> None:
        import numpy as np

        output = _inside(wfp, workspace)
        if not images:
            raise ValueError("JoyVASA returned no animation frames")
        height, width, channels = images[0].shape
        if channels != 3:
            raise ValueError("JoyVASA frames must be RGB")
        from PIL import Image

        with Image.open(job["inputs"]["portrait"]["path"]) as portrait:
            source = np.asarray(portrait.convert("RGB").resize((width, height), Image.Resampling.LANCZOS), dtype=np.float32)
        mask = _face_mask(source_keypoints["value"], height, width)
        emit_progress(
            "encoding", 0.85, "Encoding character animation with the selected H.264 encoder"
        )
        command = _encoder_command(encoding, width, height, int(kwargs.get("fps", 25)), output)
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
                assert process.stdin is not None
                for frame in images:
                    if frame.shape != (height, width, 3):
                        raise ValueError("JoyVASA changed frame dimensions during encoding")
                    if kwargs.get("image_mode", "rgb").lower() == "bgr":
                        frame = frame[..., ::-1]
                    frame = np.rint(source + mask * (frame.astype(np.float32) - source)).clip(0, 255)
                    process.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())
                process.stdin.close()
                if process.wait(timeout=300) != 0:
                    raise RuntimeError("JoyVASA frame encoding failed")
            except BaseException:
                process.kill()
                process.wait(timeout=15)
                raise

    def add_audio_to_video(video_path: str, audio_path: str, output_path: str, **_: Any) -> None:
        source = _inside(video_path, workspace)
        output = _inside(output_path, workspace)
        if not _same_path(audio_path, audio):
            raise ValueError("JoyVASA attempted to mux unrelated narration")
        subprocess.run(
            [
                str(encoding["ffmpegPath"]),
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-i",
                str(source),
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
                "-shortest",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=300,
            creationflags=creationflags,
        )

    return images2video, add_audio_to_video


def _steady_motion(sequence: Mapping[str, Any]) -> dict[str, Any]:
    """Keep the source camera/pose; transfer speech and restrained expression.

    Diffusion-generated rotation, translation and scale are not camera motion
    for a tutorial portrait. Passing them through deforms the entire scene.
    Smooth only non-mouth expression with a centered filter, avoiding added
    audio/lip delay. The upstream speech gate remains authoritative.
    """
    import numpy as np

    motion = sequence["motion"]
    if not motion:
        raise ValueError("JoyVASA returned no motion frames")
    expressions = np.stack([frame["exp"] for frame in motion])
    padded = np.pad(expressions, ((4, 4), (0, 0), (0, 0), (0, 0)), mode="edge")
    weights = (1, 2, 3, 4, 5, 4, 3, 2, 1)
    smooth = sum(weight * padded[index : index + len(motion)]
                 for index, weight in enumerate(weights)) / sum(weights)
    restrained = expressions[0] + 0.35 * (smooth - smooth[0])
    lips = [6, 12, 14, 17, 19, 20]
    restrained[:, :, lips, :] = expressions[:, :, lips, :]
    result = []
    for index, frame in enumerate(motion):
        stable = dict(frame, exp=restrained[index])
        for field in ("R", "R_d", "t", "scale", "pitch", "yaw", "roll"):
            if field in motion[0]:
                stable[field] = motion[0][field].copy()
        result.append(stable)
    return dict(sequence, motion=result)


def run_presenter_job(job: dict[str, Any], emit_progress: Callable[..., None]) -> int:
    model = job.get("model")
    if model not in {"joyvasa-human", "joyvasa-animal"}:
        raise ValueError("JoyVASA adapter requires an explicit human or animal model")
    files = {item["role"]: Path(item["path"]) for item in job["workerContract"]["files"]}
    runtime_root, source_paths = _manifest_paths(
        files["runtime-source-manifest"], "JoyVASA source manifest"
    )
    _, portrait_paths = _manifest_paths(
        files["portrait-runtime-manifest"], "portrait runtime manifest"
    )
    selected_pipeline = (
        "src/live_portrait_wmg_pipeline_animal.py"
        if model == "joyvasa-animal"
        else "src/live_portrait_wmg_pipeline.py"
    )
    for relative in (
        "src/config/argument_config.py",
        "src/config/crop_config.py",
        "src/config/inference_config.py",
        "src/config/models.yaml",
        "src/live_portrait_wmg_wrapper.py",
        "src/modules/dit_talking_head.py",
        selected_pipeline,
    ):
        _require_manifested(runtime_root / relative, source_paths, f"JoyVASA {relative}")

    expected_audio_files = {
        "audio-feature-config": "config.json",
        "audio-feature-preprocessor": "preprocessor_config.json",
        "audio-feature-weights": "pytorch_model.bin",
    }
    expected_audio_root = runtime_root / "pretrained_weights" / "chinese-hubert-base"
    for role, filename in expected_audio_files.items():
        expected = expected_audio_root / filename
        if not _same_path(files[role], expected):
            raise ValueError(
                f"JoyVASA {role} does not identify the pinned Chinese HuBERT {filename}"
            )
    output = Path(job["output"]["path"]).resolve()
    workspace = _job_workspace(job, output)
    work = workspace / "joyvasa"
    work.mkdir(exist_ok=False)
    previous_cwd = Path.cwd()
    previous_posix_path = pathlib.PosixPath
    sys.path.insert(0, str(runtime_root))
    try:
        os.chdir(runtime_root)
        # The pinned upstream motion checkpoint stores PosixPath in its options.
        if os.name == "nt":
            pathlib.PosixPath = pathlib.WindowsPath
        import numpy as np
        import torch
        from src.config.argument_config import ArgumentConfig
        from src.config.crop_config import CropConfig
        from src.config.inference_config import InferenceConfig

        seed = int(job["seed"])
        random.seed(seed)
        np.random.seed(seed % (2**32))
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        args = ArgumentConfig(
            reference=job["inputs"]["portrait"]["path"],
            audio=job["inputs"]["audio"]["path"],
            output_dir=str(work),
            animation_mode=model.removeprefix("joyvasa-"),
            motion_seed=seed,
            cfg_scale=2.0,
            # Human speech coefficients otherwise stretch animal muzzles into
            # broad lip/teeth patches. Keep animal articulation restrained.
            driving_multiplier=0.65 if model == "joyvasa-animal" else 1.10,
            flag_do_crop=False,
            flag_pasteback=False,
            flag_normalize_lip=False,
            flag_eye_retargeting=False,
            flag_lip_retargeting=False,
            flag_stitching=False,
            flag_relative_motion=False,
            flag_use_half_precision=False,
        )
        arg_values = dataclasses.asdict(args)
        inference_cfg = InferenceConfig(
            **{
                field.name: arg_values[field.name]
                for field in dataclasses.fields(InferenceConfig)
                if field.name in arg_values
            }
        )
        crop_cfg = CropConfig(
            **{
                field.name: arg_values[field.name]
                for field in dataclasses.fields(CropConfig)
                if field.name in arg_values
            }
        )
        inference_cfg.checkpoint_MotionGenerator = str(files["motion-generator-weights"])
        inference_cfg.motion_template_path = str(files["motion-template"])
        inference_cfg.checkpoint_S = None
        inference_cfg.checkpoint_S_animal = None
        checkpoint_names = (
            ("checkpoint_F_animal", "checkpoint_M_animal", "checkpoint_G_animal", "checkpoint_W_animal")
            if model == "joyvasa-animal"
            else ("checkpoint_F", "checkpoint_M", "checkpoint_G", "checkpoint_W")
        )
        for checkpoint_name in checkpoint_names:
            _require_manifested(
                getattr(inference_cfg, checkpoint_name),
                portrait_paths,
                f"JoyVASA {checkpoint_name}",
            )
        suffix = "_animal" if model == "joyvasa-animal" else ""
        pipeline_module = importlib.import_module(f"src.live_portrait_wmg_pipeline{suffix}")
        source_keypoints: dict[str, Any] = {}
        pipeline_module.images2video, pipeline_module.add_audio_to_video = _media_writers(
            job, work, emit_progress, source_keypoints
        )
        pipeline_type = getattr(
            pipeline_module, "LivePortraitPipelineAnimal" if suffix else "LivePortraitPipeline"
        )
        emit_progress("inference", 0.15, "Animating the character from the selected narration")
        pipeline = pipeline_type(inference_cfg=inference_cfg, crop_cfg=crop_cfg)
        wrapper = getattr(pipeline, "live_portrait_wrapper" + suffix)
        generate_motion = wrapper.gen_motion_sequence
        wrapper.gen_motion_sequence = lambda arguments: _steady_motion(generate_motion(arguments))
        transform_keypoint = wrapper.transform_keypoint

        def capture_source_keypoints(info: Any):
            points = transform_keypoint(info)
            source_keypoints["value"] = points.detach().cpu().numpy()
            return points

        wrapper.transform_keypoint = capture_source_keypoints
        generated = _inside(pipeline.execute(args), work)
        if not generated.is_file() or generated.stat().st_size < 1024:
            raise RuntimeError("JoyVASA produced no playable delivery")
        generated.replace(output)
        return 0
    finally:
        pathlib.PosixPath = previous_posix_path
        os.chdir(previous_cwd)
        sys.path.remove(str(runtime_root))
