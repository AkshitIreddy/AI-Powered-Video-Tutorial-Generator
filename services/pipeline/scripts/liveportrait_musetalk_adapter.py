"""Two-stage local presenter adapter: LivePortrait motion, then MuseTalk lips.

The broker verifies both source ledgers and every model/runtime input before this
module is imported. LivePortrait supplies spatially local gaze, blink,
expression, head, and shoulder motion. MuseTalk then receives that animated
video instead of the original still, so its mouth pass does not replace the
motion stage or fake breathing with a whole-frame transform.
"""

from __future__ import annotations

import copy
import gc
import hashlib
import importlib.util
import json
import os
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any, NoReturn


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _contract_files(job: dict[str, Any]) -> dict[str, Path]:
    contract = job.get("workerContract")
    if not isinstance(contract, dict) or not isinstance(contract.get("files"), list):
        _fail("Presenter contract files are missing")
    values: dict[str, Path] = {}
    for item in contract["files"]:
        if not isinstance(item, dict):
            _fail("Presenter contract file is invalid")
        role, path = item.get("role"), item.get("path")
        if not isinstance(role, str) or not isinstance(path, str):
            _fail("Presenter contract role or path is invalid")
        values[role] = Path(path).resolve(strict=True)
    return values


def _manifest_root(path: Path) -> Path:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        _fail("LivePortrait runtime manifest is invalid")
    root_value = value.get("root")
    if not isinstance(root_value, str):
        _fail("LivePortrait runtime manifest has no root")
    root = Path(root_value).resolve(strict=True)
    if root.is_symlink() or not root.is_dir():
        _fail("LivePortrait runtime root is unsafe")
    return root


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        _fail(f"Could not load pinned module {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _run_liveportrait(
    *,
    source_root: Path,
    portrait: Path,
    motion_template: Path,
    output_dir: Path,
    device_id: int,
) -> Path:
    inference = (source_root / "inference.py").resolve(strict=True)
    inference.relative_to(source_root)
    sys.path.insert(0, str(source_root))
    original_cwd = Path.cwd()
    try:
        os.chdir(source_root)
        module = _load_module(inference, "alystria_pinned_liveportrait_inference")
        argument_config = module.ArgumentConfig(
            source=str(portrait),
            driving=str(motion_template),
            output_dir=str(output_dir),
            device_id=device_id,
            flag_eye_retargeting=True,
            flag_lip_retargeting=False,
            flag_normalize_lip=False,
            flag_stitching=True,
            flag_relative_motion=True,
            flag_pasteback=True,
            driving_option="expression-friendly",
            driving_multiplier=0.75,
            animation_region="all",
        )
        inference_config = module.partial_fields(module.InferenceConfig, argument_config.__dict__)
        crop_config = module.partial_fields(module.CropConfig, argument_config.__dict__)
        pipeline = module.LivePortraitPipeline(
            inference_cfg=inference_config,
            crop_cfg=crop_config,
        )
        pipeline.execute(argument_config)
        del pipeline
    finally:
        os.chdir(original_cwd)
        if sys.path and sys.path[0] == str(source_root):
            sys.path.pop(0)
    result = output_dir / f"{portrait.stem}--{motion_template.stem}.mp4"
    if not result.is_file() or result.stat().st_size <= 1024:
        _fail("LivePortrait did not produce the declared animated portrait")
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:  # pragma: no cover - runtime contract supplies torch
        pass
    return result


def run_presenter_job(
    job: dict[str, Any], emit_progress: Callable[[str, float, str], None]
) -> int:
    if job.get("model") != "liveportrait-musetalk-1.5":
        _fail("Hybrid adapter received the wrong model identity")
    files = _contract_files(job)
    liveportrait_root = _manifest_root(files["liveportrait-runtime-manifest"])
    motion_template = files["liveportrait-motion-template"]
    original_portrait = Path(str(job["inputs"]["portrait"]["path"])).resolve(strict=True)
    output = Path(str(job["output"]["path"]))
    workspace = output.parent.parent / "workspace"
    motion_output = workspace / "liveportrait-results"
    motion_output.mkdir()
    device_id = int(str(job["gpuLease"]["deviceId"]).split(":")[-1])

    emit_progress("inference", 0.12, "Animating native gaze, blink, expression and pose")
    animated = _run_liveportrait(
        source_root=liveportrait_root,
        portrait=original_portrait,
        motion_template=motion_template,
        output_dir=motion_output,
        device_id=device_id,
    )

    musetalk = _load_module(
        files["musetalk-adapter-entrypoint"],
        "alystria_pinned_musetalk_stage",
    )
    entry = getattr(musetalk, "run_presenter_job", None)
    if not callable(entry):
        _fail("Pinned MuseTalk stage has no run_presenter_job function")
    staged_job = copy.deepcopy(job)
    staged_job["inputs"]["portrait"] = {
        "path": str(animated),
        "sha256": _sha256(animated),
        "mediaType": "video/mp4",
    }
    return int(entry(staged_job, emit_progress) or 0)
