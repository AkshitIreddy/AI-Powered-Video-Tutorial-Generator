#!/usr/bin/env python3
"""Compose the accurate three-minute candidate from verified provider outputs.

The v11 NVIDIA-authored lesson fixed a factual error in the earlier opening and
already contains six matching text-free Flux assets plus four completed Alice
clips.  ElevenLabs rejected the fifth request with HTTP 401, so this recovery
uses the two factually equivalent Alice clips already generated for v9.  Only
those older 0.74-speed clips are retimed to the approved 0.86 delivery speed;
the four v11 clips were generated at 0.86 and remain byte-identical.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.audio import measure_wav
from alystria.generation import (
    GeneratedMedia,
    GenerationCoordinator,
    GenerationStage,
    GenerationState,
    RendererOptions,
    create_production_renderer_client,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore
from alystria.research import (
    DeterministicOfflineProvider,
    GroundingMode,
    LearningObjective,
    LearningPlan,
    OutlineSection,
    ScriptDraft,
    ScriptSection,
)


def _load_evaluation_module() -> Any:
    path = ROOT / "scripts" / "run-three-minute-quality-evaluation.py"
    spec = importlib.util.spec_from_file_location(
        "alystria_three_minute_evaluation", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the three-minute evaluation harness")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


EVALUATION = _load_evaluation_module()
ALICE_VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"
V9_SOURCE_SPEED = 0.74
TARGET_SPEED = 0.86
TIMEBASE = 240_000


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--v9-root", required=True, type=Path)
    parser.add_argument("--v11-root", required=True, type=Path)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument("--presenter-config", required=True, type=Path)
    parser.add_argument(
        "--presenter-file",
        type=Path,
        default=ROOT
        / "apps"
        / "desktop"
        / "src"
        / "assets"
        / "presenters"
        / "academic-amara-v1.webp",
    )
    parser.add_argument(
        "--presenter-id", default="presenter-portrait.academic-amara-v1"
    )
    parser.add_argument("--presenter-name", default="Amara — Academic Guide")
    parser.add_argument(
        "--presenter-subject-id",
        default="fictional-synthetic-academic-amara-v1",
    )
    parser.add_argument(
        "--output-stem", default="alystria-karatsuba-3min-female-quality"
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _stage_payload(store: ProjectStore, stage: str) -> dict[str, Any]:
    row = store.connection.execute(
        "SELECT result_json FROM jobs WHERE json_extract(parameters_json, '$.stage')=? "
        "AND state='SUCCEEDED' ORDER BY completed_at DESC LIMIT 1",
        (stage,),
    ).fetchone()
    if row is None or row["result_json"] is None:
        raise RuntimeError(f"Source project has no successful {stage} stage")
    result = json.loads(str(row["result_json"]))
    payload = result.get("payload")
    if not isinstance(payload, dict):
        raise TypeError(f"Source {stage} stage has no payload")
    return payload


def _artifact_rows(store: ProjectStore, media_type: str) -> list[sqlite3.Row]:
    return list(
        store.connection.execute(
            "SELECT hash,byte_size,media_type,original_name,metadata_json "
            "FROM artifacts WHERE media_type=?",
            (media_type,),
        ).fetchall()
    )


class AccurateProviderComposition(DeterministicOfflineProvider):
    """Reconstruct one audited six-scene NVIDIA result without another API call."""

    def __init__(self, v11: ProjectStore, v9_storyboard: dict[str, Any]) -> None:
        learning = _stage_payload(v11, "learning_plan")["learningPlan"]
        self.outline_payload = list(learning["outline"])
        self.scenes = list(_stage_payload(v11, "storyboard")["storyboard"]["scenes"])
        older = list(v9_storyboard["scenes"])
        if len(self.scenes) != 6 or len(older) < 4:
            raise RuntimeError(
                "Expected the audited six-scene v11 and five-scene v9 plans"
            )

        # v9 scene 3 is the accurate complexity explanation and v9 scene 4 is
        # the concise accurate recap. The v11 first four scenes are retained.
        self.scenes[4] = {
            **self.scenes[4],
            "narration": older[2]["narration"],
            "type": "comparison",
            "visualBeat": {
                **self.scenes[4]["visualBeat"],
                "semanticIntent": "compare",
                "compositionFamily": "split_evidence",
                "motionIntent": ["compare-shift"],
            },
        }
        self.scenes[5] = {**self.scenes[5], "narration": older[3]["narration"]}

    def build_outline(
        self,
        topic: str,
        learner: Any,
        objectives: list[LearningObjective] | tuple[LearningObjective, ...],
        target_duration_seconds: int,
    ) -> tuple[OutlineSection, ...]:
        del topic, learner
        if target_duration_seconds != 180:
            raise ValueError(
                "The provider-composition recovery is pinned to 180 seconds"
            )
        known = {objective.id for objective in objectives}
        outline = tuple(
            OutlineSection.create(
                str(item["title"]),
                tuple(str(value) for value in item["objectiveIds"]),
                teaching_strategy=str(item["teachingStrategy"]),
                estimated_seconds=int(item["estimatedSeconds"]),
                evidence_claim_ids=tuple(
                    str(value) for value in item["evidenceClaimIds"]
                ),
            )
            for item in self.outline_payload
        )
        if {value for item in outline for value in item.objective_ids} != known:
            raise ValueError("Cached outline does not cover the current objective set")
        return outline

    def draft_script(self, plan: LearningPlan, grounding: GroundingMode) -> ScriptDraft:
        if len(plan.outline) != len(self.scenes):
            raise ValueError(
                "Cached lesson no longer matches the reconstructed outline"
            )
        sections: list[ScriptSection] = []
        for index, (outline, scene) in enumerate(
            zip(plan.outline, self.scenes, strict=True)
        ):
            scene_type = str(scene["type"])
            narration = str(scene["narration"])
            if index == 0:
                # Presenter placement is applied by the storyboard compiler.
                scene_type = "question"
                # The source storyboard already contains the compiler's hook.
                # Feed the pre-compiler form back in so it is not duplicated.
                hook = "What do you predict will happen? "
                if not narration.startswith(hook):
                    raise ValueError(
                        "Cached opening no longer contains the expected hook"
                    )
                narration = narration[len(hook) :]
            sections.append(
                ScriptSection(
                    outline.id,
                    narration,
                    str(scene["visualIntent"]),
                    tuple(str(value) for value in scene["claimIds"]),
                    scene_type=scene_type,
                    title=str(scene["title"]),
                    on_screen_text=tuple(str(value) for value in scene["onScreenText"]),
                    visual_beat=dict(scene["visualBeat"]),
                )
            )
        return ScriptDraft.create(
            sections,
            locale=plan.learner.locale,
            revision=1,
            metadata={
                "grounding": grounding.value,
                "provider": "nvidia-nim",
                "model": "openai/gpt-oss-20b",
                "providerComposition": "v11-first-four-plus-v9-accurate-tail",
            },
        )


class CachedProviderMedia:
    """Replay exact NVIDIA visual and ElevenLabs audio provider artifacts."""

    provider_id = "elevenlabs"
    model_revision = "eleven_multilingual_v2"

    def __init__(
        self,
        destination: ProjectStore,
        v11: ProjectStore,
        v9: ProjectStore,
        v11_storyboard: dict[str, Any],
        ffmpeg: Path,
    ) -> None:
        self.destination = destination
        self.v11 = v11
        self.v9 = v9
        self.ffmpeg = ffmpeg.resolve(strict=True)
        self.work = destination.root / "staging" / "provider-composition"
        self.work.mkdir(parents=True, exist_ok=True)

        title_to_id = {
            str(scene["title"]): str(scene["id"]) for scene in v11_storyboard["scenes"]
        }
        image_by_id: dict[str, sqlite3.Row] = {}
        for row in _artifact_rows(v11, "image/jpeg"):
            metadata = json.loads(str(row["metadata_json"]))
            scene_id = metadata.get("sceneId")
            if isinstance(scene_id, str):
                image_by_id[scene_id] = row
        self.image_by_title = {
            title: image_by_id[scene_id]
            for title, scene_id in title_to_id.items()
            if scene_id in image_by_id
        }
        if len(self.image_by_title) != 6:
            raise RuntimeError("The v11 project does not contain all six Flux assets")

        self.audio_by_text: dict[str, tuple[ProjectStore, sqlite3.Row, float]] = {}
        for source, source_speed in ((v11, TARGET_SPEED), (v9, V9_SOURCE_SPEED)):
            for row in _artifact_rows(source, "audio/mpeg"):
                metadata = json.loads(str(row["metadata_json"]))
                text_hash = metadata.get("textSha256")
                if isinstance(text_hash, str):
                    self.audio_by_text[text_hash] = (source, row, source_speed)

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        del seed
        title = str(scene["title"])
        try:
            row = self.image_by_title[title]
        except KeyError as error:
            raise RuntimeError(
                f"No matching audited Flux asset exists for {title!r}"
            ) from error
        digest = str(row["hash"])
        if not self.v11.cas.verify(digest):
            raise RuntimeError(f"Cached Flux asset is corrupt for {title!r}")
        metadata = json.loads(str(row["metadata_json"]))
        metadata.update(
            {
                "sourceArtifactHash": digest,
                "providerComposition": "exact-cached-output",
            }
        )
        with self.v11.cas.open(digest) as stream:
            content = stream.read()
        return GeneratedMedia(
            content,
            str(row["media_type"]),
            str(row["original_name"] or f"{scene['id']}.jpg"),
            "nvidia-nim",
            str(metadata.get("modelRevision", "black-forest-labs/flux.2-klein-4b")),
            metadata,
            0,
            {"images": 1.0},
        )

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        del seed
        text_hash = hashlib.sha256(str(scene["narration"]).encode()).hexdigest()
        try:
            source, row, source_speed = self.audio_by_text[text_hash]
        except KeyError as error:
            raise RuntimeError(
                f"No exact cached Alice narration matches scene {scene['id']}"
            ) from error
        digest = str(row["hash"])
        if not source.cas.verify(digest):
            raise RuntimeError(f"Cached Alice narration is corrupt for {scene['id']}")
        source_metadata = json.loads(str(row["metadata_json"]))
        base_metadata = {
            **source_metadata,
            "locale": locale,
            "voiceId": ALICE_VOICE_ID,
            "voiceName": "Alice",
            "speed": TARGET_SPEED,
            "sourceSpeed": source_speed,
            "sourceArtifactHash": digest,
            "providerComposition": "exact-cached-output",
        }
        if source_speed == TARGET_SPEED:
            with source.cas.open(digest) as stream:
                content = stream.read()
            return GeneratedMedia(
                content,
                "audio/mpeg",
                f"{scene['id']}.alice-0.86.mp3",
                self.provider_id,
                self.model_revision,
                base_metadata,
                0,
                {"characters": float(len(str(scene["narration"])))},
            )

        scene_root = self.work / str(scene["id"])
        scene_root.mkdir(parents=True, exist_ok=True)
        source_path = scene_root / "source.mp3"
        output_path = scene_root / "alice-speed-0.86.wav"
        source.cas.copy_to(digest, source_path)
        completed = subprocess.run(
            (
                str(self.ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(source_path),
                "-filter:a",
                f"atempo={TARGET_SPEED / source_speed:.12f}",
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(output_path),
            ),
            cwd=scene_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )
        if completed.returncode != 0:
            raise RuntimeError(
                "Pinned FFmpeg could not retime cached Alice narration: "
                + completed.stderr.decode("utf-8", errors="replace")[-2_000:]
            )
        content = output_path.read_bytes()
        measured = measure_wav(content)
        base_metadata.update(
            {
                "recoveryTransform": "ffmpeg-atempo-pitch-preserving",
                "ffmpegSha256": sha256_file(self.ffmpeg),
                "durationMs": round(measured.duration_ms),
                "sampleRateHz": measured.sample_rate_hz,
                "channels": measured.channels,
                "durationSource": "decoded-audio-frames",
            }
        )
        return GeneratedMedia(
            content,
            "audio/wav",
            f"{scene['id']}.alice-0.86.wav",
            self.provider_id,
            self.model_revision,
            base_metadata,
            0,
            {"characters": float(len(str(scene["narration"])))},
        )

    def create_presenter(
        self, scene: dict[str, Any], *, narration_hash: str, seed: int
    ) -> GeneratedMedia | None:
        del scene, narration_hash, seed
        return None


def _coordinator_stage_payload(
    coordinator: GenerationCoordinator, generation_id: str, stage: GenerationStage
) -> dict[str, Any]:
    job = next(
        item
        for item in coordinator._jobs(generation_id)
        if item.parameters.get("stage") == stage.value
    )
    if job.result is None or not isinstance(job.result.get("payload"), dict):
        raise RuntimeError(f"Stage {stage.value} has no payload")
    return job.result["payload"]


def main() -> int:
    options = arguments()
    output = options.output_root.resolve()
    if output.exists():
        raise FileExistsError(f"Output root already exists: {output}")
    output.mkdir(parents=True)
    runtime_pack = options.runtime_pack.resolve(strict=True)
    v9 = ProjectStore.open(options.v9_root.resolve(strict=True), readonly=True)
    v11 = ProjectStore.open(options.v11_root.resolve(strict=True), readonly=True)
    destination = ProjectStore.create(
        output / "project",
        name=f"Accurate Karatsuba 3-minute test — {options.presenter_name}",
    )
    try:
        v9_storyboard = json.loads(
            (options.v9_root.parent / "approved-storyboard.json").read_text(
                encoding="utf-8"
            )
        )
        v11_storyboard = json.loads(
            (options.v11_root.parent / "approved-storyboard.json").read_text(
                encoding="utf-8"
            )
        )
        provider = AccurateProviderComposition(v11, v9_storyboard)

        portrait = options.presenter_file.resolve(strict=True)
        portrait_hash = sha256_file(portrait)
        portrait_media_type = {
            ".jpeg": "image/jpeg",
            ".jpg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(portrait.suffix.lower())
        if portrait_media_type is None:
            raise ValueError(
                f"Unsupported presenter image format: {portrait.suffix or '<none>'}"
            )
        EVALUATION.AMARA_ID = options.presenter_id
        EVALUATION.AMARA_HASH = portrait_hash
        portrait_artifact = destination.add_artifact_bytes(
            portrait.read_bytes(),
            media_type=portrait_media_type,
            original_name=portrait.name,
            metadata={
                "assetId": options.presenter_id,
                "origin": "generated",
                "rightsStatus": "verified",
                "licenseId": "LicenseRef-USER-OWNED",
                "creator": "Alystria project owner",
            },
        )
        destination.create_revision(
            snapshot={
                "brief": {
                    "topic": "Karatsuba multiplication: why three products beat four",
                    "audience": "First-year algorithms students",
                    "durationSeconds": 180,
                    "locale": "en-US",
                },
                "providerComposition": {
                    "writing": "real NVIDIA NIM structured outputs from v11 and v9",
                    "images": "real NVIDIA NIM Flux outputs from v11",
                    "narration": "real ElevenLabs Alice outputs from v11 and v9",
                },
            },
            kind="edit",
            name="Accurate provider-output composition brief",
        )
        cached = CachedProviderMedia(
            destination,
            v11,
            v9,
            v11_storyboard,
            runtime_pack / "ffmpeg" / "ffmpeg.exe",
        )
        presenter_config = EVALUATION.prepare_presenter_config(
            output, options.presenter_config
        )
        selected_config = json.loads(presenter_config.read_text(encoding="utf-8"))
        selected_config["defaultProfileId"] = options.presenter_id
        selected_config["profiles"] = [
            {
                "profileId": options.presenter_id,
                "portraitArtifactHash": portrait_hash,
                "subjectId": options.presenter_subject_id,
            }
        ]
        presenter_config = output / "presenter-runtime-selected.json"
        presenter_config.write_text(
            json.dumps(selected_config, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        media = load_local_presenter_media_client(destination, cached, presenter_config)
        renderer = create_production_renderer_client(
            destination,
            repository_root=ROOT,
            runtime_manifest_path=ROOT / "runtime-manifest.json",
            node_path=runtime_pack / "node" / "node.exe",
            chromium_path=runtime_pack / "chromium" / "chrome.exe",
            ffmpeg_path=runtime_pack / "ffmpeg" / "ffmpeg.exe",
            ffprobe_path=runtime_pack / "ffmpeg" / "ffprobe.exe",
            renderer_cli_path=ROOT
            / "services"
            / "renderer"
            / "dist"
            / "src"
            / "cli.js",
            options=RendererOptions(
                codec="vp9",
                quality=31,
                concurrency=4,
                chunk_frames=180,
                timeout_seconds=10_800,
                caption_delivery_mode="sidecar",
            ),
        )
        coordinator = GenerationCoordinator(
            destination,
            media_client=media,
            renderer_client=renderer,
            educational_provider=provider,
        )
        request = EVALUATION.build_request(portrait_artifact.hash)
        visual = request.metadata["visualCustomization"]
        visual["assets"][0]["alt"] = (
            f"{options.presenter_name}, fictional synthetic presenter"
        )
        visual["assets"][0]["mediaType"] = portrait_media_type
        visual["presenter"]["profile"]["displayName"] = options.presenter_name
        generation_id = coordinator.start(request).generation_id
        waiting = coordinator.run_pending()
        if waiting is None or waiting.state is not GenerationState.WAITING_APPROVAL:
            raise RuntimeError(f"Pre-approval generation failed: {waiting}")
        preapproval = _coordinator_stage_payload(
            coordinator, generation_id, GenerationStage.STORYBOARD
        )
        storyboard = preapproval["storyboard"]
        EVALUATION.validate_storyboard(storyboard)
        flattened = " ".join(str(scene["narration"]) for scene in storyboard["scenes"])
        if "doubling it" in flattened or "2·(a·d)" in flattened:
            raise ValueError(
                "The disproved cross-term shortcut survived into the storyboard"
            )
        (output / "approved-storyboard.json").write_text(
            json.dumps(storyboard, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        coordinator.approve(
            generation_id, name="QA-approved accurate three-minute storyboard"
        )
        completed = coordinator.run_pending()
        if completed is None or completed.state is not GenerationState.SUCCEEDED:
            raise RuntimeError(
                f"Accurate provider-output generation failed: {completed}"
            )

        narration = _coordinator_stage_payload(
            coordinator, generation_id, GenerationStage.NARRATION
        )
        measured_storyboard = narration["storyboard"]
        if (
            sum(int(scene["durationTicks"]) for scene in measured_storyboard["scenes"])
            != 180 * TIMEBASE
        ):
            raise RuntimeError(
                "Measured narration fit did not preserve exactly 180 seconds"
            )
        (output / "measured-storyboard.json").write_text(
            json.dumps(
                measured_storyboard, indent=2, ensure_ascii=False, sort_keys=True
            )
            + "\n",
            encoding="utf-8",
        )

        exported = _coordinator_stage_payload(
            coordinator, generation_id, GenerationStage.EXPORT
        )
        manifest = exported["exportManifest"]
        delivered: dict[str, str] = {}
        for item in manifest["files"]:
            role = str(item["role"])
            suffix = {
                "video": ".webm",
                "captions": ".vtt",
                "captions-srt": ".srt",
                "transcript": ".txt",
            }[role]
            destination_path = (
                output / f"{options.output_stem}{suffix}"
            )
            destination.cas.copy_to(str(item["artifactHash"]), destination_path)
            delivered[role] = str(destination_path)
        report = {
            "schemaVersion": 1,
            "generationId": generation_id,
            "durationSeconds": 180,
            "voice": {
                "provider": "elevenlabs",
                "model": "eleven_multilingual_v2",
                "voiceId": ALICE_VOICE_ID,
                "name": "Alice",
                "speed": TARGET_SPEED,
                "composition": "four exact v11 clips plus two exact v9 clips retimed with pinned FFmpeg atempo",
            },
            "presenter": {
                "profileId": options.presenter_id,
                "name": options.presenter_name,
                "mouthMask": "raw identity-preserving MuseTalk mask",
            },
            "writing": {
                "provider": "nvidia-nim",
                "model": "openai/gpt-oss-20b",
                "composition": "accurate six-scene v11 result plus factually equivalent v9 complexity and recap narration",
            },
            "images": {
                "provider": "nvidia-nim",
                "model": "black-forest-labs/flux.2-klein-4b",
                "composition": "six exact v11 supporting-art candidates preserved in provenance",
                "rendered": False,
                "renderPolicy": (
                    "Generated backgrounds were suppressed because visual review found "
                    "glyph-like pseudo-text; Alystria-rendered semantic diagrams and typography "
                    "remain authoritative."
                ),
            },
            "qualityGate": manifest["qualityGate"],
            "files": delivered,
        }
        (output / "quality-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    finally:
        destination.close()
        v11.close()
        v9.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
