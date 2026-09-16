#!/usr/bin/env python3
"""Run one real, routed, three-minute AI Video Tutorial Generator evaluation."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation import (
    ClaimSpec,
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    ObjectiveSpec,
    RendererOptions,
    RuntimeGenerationMediaClient,
    SourceSpec,
    StructuredWritingEducationalProvider,
    create_production_renderer_client,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore
from alystria.providers import (
    EphemeralCredentialBroker,
    ProviderRuntimeFactory,
    UrllibTransport,
    parse_routing_policy,
)
from alystria.research import GroundingMode

AMARA_ID = "presenter-portrait.academic-amara-v1"
AMARA_HASH = "97067bcbeea43e043089692aa3b920ac5bd77cdd9cdb21b78ddc1f50af5221b5"
ALICE_VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument("--presenter-config", required=True, type=Path)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def credential_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.resolve(strict=True).read_text(encoding="utf-8-sig").splitlines():
        match = re.match(
            r"\s*([A-Za-z][A-Za-z0-9 ._-]{0,40}?)(?:\s*[:=\t]|\s{2,})(\S.*?)\s*$",
            raw,
        )
        if match:
            values[match.group(1).strip().casefold()] = match.group(2).strip()
    return values


def routing_policy() -> dict[str, Any]:
    approvals = [
        {
            "providerId": "nvidia-nim",
            "capabilities": ["llm.structured", "image.generate"],
            "credentialRef": "keyring://alystria/nvidia-nim/api_key",
            "boundary": "cloud",
            "retention": "provider_default",
            "regions": ["provider-managed"],
            "dataClasses": ["public"],
            "privacyApproved": True,
            "retentionApproved": True,
            "regionApproved": True,
            "termsApproved": True,
            "modelAccessCheckedAt": "2026-09-01T00:00:00Z",
        },
        {
            "providerId": "elevenlabs",
            "capabilities": ["audio.tts"],
            "credentialRef": "keyring://alystria/elevenlabs/api_key",
            "boundary": "cloud",
            "retention": "provider_default",
            "regions": ["provider-managed"],
            "dataClasses": ["public"],
            "privacyApproved": True,
            "retentionApproved": True,
            "regionApproved": True,
        },
    ]
    routes = [
        {
            "capability": "llm.structured",
            "providerIds": ["nvidia-nim"],
            "model": "openai/gpt-oss-20b",
            "voice": None,
        },
        {
            "capability": "image.generate",
            "providerIds": ["nvidia-nim"],
            "model": "black-forest-labs/flux.2-klein-4b",
            "voice": None,
        },
        {
            "capability": "audio.tts",
            "providerIds": ["elevenlabs"],
            "model": "eleven_multilingual_v2",
            "voice": ALICE_VOICE_ID,
        },
    ]
    return {
        "version": 1,
        "privacyMode": "cloud",
        "dataClassification": "public",
        "approvals": approvals,
        "routes": routes,
    }


def prepare_presenter_config(output: Path, base_config: Path) -> Path:
    config = json.loads(base_config.resolve(strict=True).read_text(encoding="utf-8"))
    config["defaultProfileId"] = AMARA_ID
    config["profiles"] = [
        {
            "profileId": AMARA_ID,
            "portraitArtifactHash": AMARA_HASH,
            "subjectId": "fictional-synthetic-academic-amara-v1",
        },
    ]
    path = output / "presenter-runtime-amara.json"
    path.write_text(
        json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return path


def stage_payload(
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


def validate_storyboard(storyboard: dict[str, Any]) -> None:
    scenes = storyboard.get("scenes")
    if not isinstance(scenes, list) or not 3 <= len(scenes) <= 7:
        raise ValueError("Live storyboard did not contain three to seven scenes")
    if sum(int(scene["durationTicks"]) for scene in scenes) != 180 * 240_000:
        raise ValueError("Live storyboard is not exactly three minutes")
    flattened = " ".join(
        text
        for scene in scenes
        for text in (
            str(scene.get("title", "")),
            str(scene.get("narration", "")),
            *[str(value) for value in scene.get("onScreenText", [])],
            *[
                str(unit.get("text", ""))
                for unit in scene.get("visualBeat", {}).get("informationUnits", [])
                if isinstance(unit, dict)
            ],
        )
    )
    digits = re.sub(r"\D", "", flattened)
    if "7006652" not in digits or "2840" not in digits:
        raise ValueError(
            "Storyboard omitted the verified Karatsuba worked-example results"
        )
    if "7005652" in digits or re.search(
        r"\bcross\D{0,8}2830\b", flattened, re.IGNORECASE
    ):
        raise ValueError("Storyboard contains a known incorrect worked-example result")
    if re.search(
        r"(?:\bdoubl(?:e|ing)\b.{0,48}\bcross|\bcross\b.{0,48}\bdoubl(?:e|ing)\b|2\s*[·*]\s*\(?a\s*[·*]\s*d\)?)",
        flattened,
        re.IGNORECASE,
    ):
        raise ValueError(
            "Storyboard incorrectly treats Karatsuba's distinct cross terms ad and bc as one doubled term"
        )
    if (
        "Start with a question" in flattened
        or "connect this to what you just" in flattened
    ):
        raise ValueError("Storyboard contains deterministic placeholder prose")
    for scene in scenes:
        narration = str(scene.get("narration", ""))
        if re.search(r"\b([A-Za-z]{3,})\s+\1\b", narration, re.IGNORECASE):
            raise ValueError("Storyboard contains an accidentally duplicated word")


def build_request(portrait_hash: str) -> GenerationRequest:
    exact_source = (
        "Karatsuba writes x = aB + b and y = cB + d, then computes z2 = ac, z0 = bd, "
        "and z1 = (a+b)(c+d) - z2 - z0. For 1234 × 5678 with B = 100: a = 12, "
        "b = 34, c = 56, d = 78. The products are z2 = 672, z0 = 2652, and "
        "(a+b)(c+d) = 46 × 134 = 6164, so z1 = 6164 - 672 - 2652 = 2840. "
        "Recombining gives 672 × 10000 + 2840 × 100 + 2652 = 7,006,652. "
        "The recurrence T(n) = 3T(n/2) + O(n) solves to O(n^log2 3), about O(n^1.585), "
        "instead of the grade-school recurrence 4T(n/2) + O(n) = O(n²). "
        "Karatsuba replaces four recursive products with exactly three. "
        "The verified worked example has cross term 2840 and result 7,006,652. "
        "Karatsuba runs in O(n^1.585), improving on grade-school O(n²)."
    )
    return GenerationRequest(
        topic="Karatsuba multiplication: why three products beat four",
        audience="First-year algorithms students",
        duration_seconds=180,
        grounding_mode=GroundingMode.GROUNDED,
        sources=(
            SourceSpec(
                "source-karatsuba-verified",
                "Verified Karatsuba derivation and worked example",
                exact_source,
                "inline:verified-karatsuba-notes",
                "text/plain",
                "CC0-1.0",
                "AI Video Tutorial Generator QA",
            ),
        ),
        objectives=(
            ObjectiveSpec(
                "objective-three-products",
                "Explain why Karatsuba replaces four recursive products with exactly three.",
                "understand",
            ),
            ObjectiveSpec(
                "objective-worked-example",
                "Apply the verified example: 1234 × 5678 uses 672, 2652, 6164, cross term 2840, and result 7,006,652.",
                "apply",
            ),
            ObjectiveSpec(
                "objective-complexity",
                "Compare T(n)=3T(n/2)+O(n)=O(n^1.585) with grade-school O(n²).",
                "analyze",
            ),
        ),
        claims=(
            ClaimSpec(
                "claim-three-products",
                "Karatsuba replaces four recursive products with exactly three.",
                "source-karatsuba-verified",
                "critical",
            ),
            ClaimSpec(
                "claim-example",
                "The verified worked example has cross term 2840 and result 7,006,652.",
                "source-karatsuba-verified",
                "critical",
            ),
            ClaimSpec(
                "claim-complexity",
                "Karatsuba runs in O(n^1.585), improving on grade-school O(n²).",
                "source-karatsuba-verified",
                "high",
            ),
        ),
        prerequisites=("place value", "algebraic expansion", "recurrence relations"),
        output_targets=(
            {"name": "landscape", "width": 1920, "height": 1080, "fps": 30},
        ),
        presenter_mode="on",
        deterministic_seed=20260901,
        metadata={
            "quality": "studio",
            "distributionPurpose": "private",
            "providerRoutingPolicy": routing_policy(),
            "visualCustomization": {
                "schemaVersion": 1,
                "assets": [
                    {
                        "assetId": AMARA_ID,
                        "artifactHash": portrait_hash,
                        "mediaType": "image/webp",
                        "role": "presenter-portrait",
                        "source": "starter",
                        "fit": "cover",
                        "alt": "Amara, fictional synthetic academic guide",
                    }
                ],
                "presenter": {
                    "enabled": True,
                    "placement": "picture_in_picture",
                    "fit": "cover",
                    "side": "right",
                    "scalePercent": 72,
                    "frame": "soft",
                    "profile": {
                        "profileId": AMARA_ID,
                        "displayName": "Amara — Academic Guide",
                        "identityType": "synthetic",
                        "disclosureRequired": True,
                        "modelInputAllowed": True,
                    },
                },
                "captionStyle": {
                    "position": "auto",
                    "style": "soft-panel",
                    "sizePercent": 100,
                    "safeInsetPercent": 8,
                    "maxLines": 2,
                    "textColor": "#FFFFFF",
                    "panelColor": "#151827",
                    "fontFamily": "Atkinson Hyperlegible Next",
                    "fallbackFamilies": ["Arial", "sans-serif"],
                },
                "warnings": [],
            },
            "audioCustomization": {
                "schemaVersion": 1,
                "inputs": [],
                "mix": {"musicDuckingDb": -12.96},
            },
            "fontCustomization": {"schemaVersion": 1, "fonts": [], "warnings": []},
        },
    )


def main() -> int:
    options = arguments()
    output = options.output_root.resolve()
    if output.exists():
        raise FileExistsError(f"Output root already exists: {output}")
    output.mkdir(parents=True)
    secrets = credential_values(options.credentials_file)
    nvidia = secrets.get("nvidia_nim") or secrets.get("nvidia nim")
    elevenlabs = secrets.get("elevenlabs")
    if not nvidia or not elevenlabs:
        raise RuntimeError("The NVIDIA NIM and ElevenLabs credentials are required")

    store = ProjectStore.create(
        output / "project", name="Karatsuba 3-minute quality test"
    )
    broker = EphemeralCredentialBroker()
    nvidia_grant = broker.issue(
        "nvidia-nim", "keyring://alystria/nvidia-nim/api_key", nvidia
    )
    eleven_grant = broker.issue(
        "elevenlabs", "keyring://alystria/elevenlabs/api_key", elevenlabs
    )
    nvidia = ""
    elevenlabs = ""
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Karatsuba multiplication: why three products beat four",
                    "audience": "First-year algorithms students",
                    "durationSeconds": 180,
                    "locale": "en-US",
                },
                "providerRoutingPolicy": routing_policy(),
            },
            kind="edit",
            name="Three-minute quality brief",
        )
        portrait = (
            ROOT
            / "apps"
            / "desktop"
            / "src"
            / "assets"
            / "presenters"
            / "academic-amara-v1.webp"
        )
        if sha256_file(portrait) != AMARA_HASH:
            raise ValueError("The bundled Amara portrait hash changed")
        portrait_artifact = store.add_artifact_bytes(
            portrait.read_bytes(),
            media_type="image/webp",
            original_name=portrait.name,
            metadata={
                "assetId": AMARA_ID,
                "origin": "generated",
                "rightsStatus": "verified",
                "licenseId": "LicenseRef-USER-OWNED",
                "creator": "AI Video Tutorial Generator project owner",
            },
        )
        policy = parse_routing_policy(routing_policy())
        runtime = ProviderRuntimeFactory(
            transport_factory=lambda _provider: UrllibTransport(),
            credential_resolver=broker,
            credential_grants={
                "nvidia-nim": nvidia_grant,
                "elevenlabs": eleven_grant,
            },
        ).build(policy)
        media = RuntimeGenerationMediaClient(runtime)
        presenter_config = prepare_presenter_config(output, options.presenter_config)
        media = load_local_presenter_media_client(store, media, presenter_config)

        runtime_pack = options.runtime_pack.resolve(strict=True)
        renderer = create_production_renderer_client(
            store,
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
            store,
            media_client=media,
            renderer_client=renderer,
            educational_provider=StructuredWritingEducationalProvider.from_runtime(
                runtime
            ),
        )
        request = build_request(portrait_artifact.hash)
        generation_id = coordinator.start(request).generation_id
        waiting = coordinator.run_pending()
        if waiting is None or waiting.state is not GenerationState.WAITING_APPROVAL:
            raise RuntimeError(f"Pre-approval generation failed: {waiting}")
        preapproval = stage_payload(
            coordinator, generation_id, GenerationStage.STORYBOARD
        )
        storyboard = preapproval["storyboard"]
        validate_storyboard(storyboard)
        (output / "approved-storyboard.json").write_text(
            json.dumps(storyboard, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        coordinator.approve(generation_id, name="QA-approved three-minute storyboard")
        completed = coordinator.run_pending()
        if completed is None or completed.state is not GenerationState.SUCCEEDED:
            raise RuntimeError(f"Post-approval generation failed: {completed}")
        exported = stage_payload(coordinator, generation_id, GenerationStage.EXPORT)
        manifest = exported["exportManifest"]
        delivered: dict[str, str] = {}
        for item in manifest["files"]:
            role = str(item["role"])
            digest = str(item["artifactHash"])
            suffix = {
                "video": ".webm",
                "captions": ".vtt",
                "captions-srt": ".srt",
                "transcript": ".txt",
            }[role]
            destination = output / f"ai-video-tutorial-generator-karatsuba-3min{suffix}"
            store.cas.copy_to(digest, destination)
            delivered[role] = str(destination)
        report = {
            "schemaVersion": 1,
            "generationId": generation_id,
            "durationSeconds": 180,
            "voice": {
                "provider": "elevenlabs",
                "model": "eleven_multilingual_v2",
                "voiceId": ALICE_VOICE_ID,
                "name": "Alice",
                "speed": 0.86,
            },
            "presenter": {"profileId": AMARA_ID, "name": "Amara"},
            "writing": {"provider": "nvidia-nim", "model": "openai/gpt-oss-20b"},
            "images": {
                "provider": "nvidia-nim",
                "model": "black-forest-labs/flux.2-klein-4b",
                "textFreePromptGuard": True,
            },
            "qualityGate": manifest["qualityGate"],
            "files": delivered,
        }
        (output / "quality-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    finally:
        broker.revoke(nvidia_grant)
        broker.revoke(eleven_grant)
        broker.close()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
