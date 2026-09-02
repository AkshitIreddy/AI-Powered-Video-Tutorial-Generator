#!/usr/bin/env python3
"""Render a short, reproducible presenter identity-preservation specimen."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation import (
    DeterministicMediaClient,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-config", required=True, type=Path)
    parser.add_argument("--portrait", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--profile-id")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    options = arguments()
    output = options.output_root.resolve()
    output.mkdir(parents=True, exist_ok=False)

    config = json.loads(
        options.base_config.resolve(strict=True).read_text(encoding="utf-8")
    )
    runtime_root = Path(str(config["runtimeRoot"]))
    runtime_adapter = (
        runtime_root / "musetalk-runtime" / "worker" / "musetalk_v15_adapter.py"
    )
    source_adapter = (
        ROOT / "services" / "pipeline" / "scripts" / "musetalk_v15_adapter.py"
    )
    shutil.copy2(source_adapter, runtime_adapter)
    adapter_hash = sha256_file(runtime_adapter)
    adapter_record = next(
        item
        for item in config["workerContract"]["files"]
        if item.get("role") == "adapter-entrypoint"
    )
    adapter_record["sha256"] = adapter_hash
    config["modelRevision"] = (
        f"musetalk-1.5+identity-lip-aperture-{adapter_hash[:12]}"
    )
    config["installFingerprint"] = hashlib.sha256(
        json.dumps(config["workerContract"], sort_keys=True).encode()
    ).hexdigest()
    config_path = output / "presenter-runtime-arjun-raw.json"
    config_path.write_text(
        json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    store = ProjectStore.create(
        output / "project", name="Arjun beard preservation check"
    )
    try:
        portrait = options.portrait.resolve(strict=True)
        audio = options.audio.resolve(strict=True)
        portrait_artifact = store.add_artifact_bytes(
            portrait.read_bytes(),
            media_type="image/png",
            original_name=portrait.name,
            metadata={"purpose": "identity-preservation-specimen"},
        )
        profile_id = options.profile_id or str(config["defaultProfileId"])
        expected_portrait_hash = next(
            item["portraitArtifactHash"]
            for item in config["profiles"]
            if item["profileId"] == profile_id
        )
        if portrait_artifact.hash != expected_portrait_hash:
            raise ValueError("Portrait does not match the configured presenter profile")
        audio_artifact = store.add_artifact_bytes(
            audio.read_bytes(),
            media_type="audio/wav",
            original_name=audio.name,
            metadata={"purpose": "identity-preservation-specimen"},
        )
        presenter = load_local_presenter_media_client(
            store, DeterministicMediaClient(), config_path
        )
        result = presenter.create_presenter(
            {
                "id": "arjun-beard-preservation-check",
                "presenterProfileId": profile_id,
            },
            narration_hash=audio_artifact.hash,
            seed=20260901,
        )
        video = output / "arjun-raw-mask-beard-check.mp4"
        video.write_bytes(result.content)
        report = {
            "schemaVersion": 1,
            "video": str(video),
            "videoSha256": sha256_file(video),
            "portraitSha256": portrait_artifact.hash,
            "audioSha256": audio_artifact.hash,
            "modelRevision": result.model_revision,
            "metadata": result.metadata,
        }
        (output / "identity-check.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
