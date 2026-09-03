#!/usr/bin/env python3
"""Create three compact, real AI Video Tutorial Generator showcase videos.

The showcase deliberately exercises three different native rendering paths:
an identity-preserving local presenter, narration-timed whiteboard drawing, and
narration-timed live coding. Provider secrets are read only into an ephemeral
credential broker and generated media stays under the requested output root.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import stat
import sys
import urllib.error
import urllib.request
import uuid
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation import (
    GeneratedMedia,
    RendererOptions,
    create_production_renderer_client,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore

TIMEBASE = 240_000
MAGPIE_ENDPOINT = (
    "https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com"
    "/v1/audio/synthesize"
)
MAGPIE_VOICE = "Magpie-Multilingual.EN-US.Aria.Calm"
MAYA_PROFILE_ID = "presenter-portrait.educator-maya-v2"
GPU_LOCK = Path(r"C:\Users\akshi\Desktop\Code Palace\gpu use.txt")


@dataclass(frozen=True, slots=True)
class Demo:
    slug: str
    title: str
    description: str
    scenes: tuple[dict[str, Any], ...]
    presenter_scene_id: str | None = None


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--credentials-file", required=True, type=Path)
    parser.add_argument("--runtime-pack", required=True, type=Path)
    parser.add_argument("--presenter-config", required=True, type=Path)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reuse completed showcase reports and rebuild only incomplete demo folders.",
    )
    parser.add_argument(
        "--presenter-file",
        type=Path,
        default=ROOT
        / "apps"
        / "desktop"
        / "src"
        / "assets"
        / "presenters"
        / "educator-maya-v2.webp",
    )
    parser.add_argument(
        "--recovered-presenter-video",
        type=Path,
        help="Reuse a verified MP4 recovered from a completed presenter frame sequence.",
    )
    parser.add_argument(
        "--recovered-presenter-audio",
        type=Path,
        help="Narration WAV that exactly matches the recovered presenter video.",
    )
    return parser.parse_args()


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


class NvidiaMagpieMediaClient:
    """Narrow HTTPS client for NVIDIA's hosted Magpie multilingual TTS NIM."""

    provider_id = "nvidia-nim"
    model_revision = "nvidia/magpie-tts-multilingual"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        del seed
        fields = {
            "text": str(scene["narration"]),
            "language": locale,
            "voice": MAGPIE_VOICE,
            "encoding": "LINEAR_PCM",
            "sample_rate_hz": "48000",
        }
        boundary = f"alystria-{uuid.uuid4().hex}"
        body = bytearray()
        for name, value in fields.items():
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            )
            body.extend(value.encode("utf-8"))
            body.extend(b"\r\n")
        body.extend(f"--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            MAGPIE_ENDPOINT,
            data=bytes(body),
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Accept": "audio/wav, application/octet-stream",
                "User-Agent": "AI-Video-Tutorial-Generator/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                content = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read(1_000).decode("utf-8", errors="replace")
            raise RuntimeError(
                f"NVIDIA Magpie TTS returned HTTP {error.code}: {detail}"
            ) from error
        if not content.startswith(b"RIFF"):
            raise RuntimeError("NVIDIA Magpie TTS did not return a RIFF WAV file")
        with wave.open(io.BytesIO(content), "rb") as stream:
            duration_ms = round(stream.getnframes() * 1_000 / stream.getframerate())
            sample_rate = stream.getframerate()
            channels = stream.getnchannels()
        return GeneratedMedia(
            content,
            "audio/wav",
            f"{scene['id']}.magpie-aria-calm.wav",
            self.provider_id,
            self.model_revision,
            {
                "origin": "generated",
                "rightsStatus": "verified",
                "licenseId": "LicenseRef-NVIDIA-AI-FOUNDATION-MODELS",
                "durationMs": duration_ms,
                "sampleRateHz": sample_rate,
                "channels": channels,
                "locale": locale,
                "voiceId": MAGPIE_VOICE,
                "voiceName": "Aria Calm",
            },
            0,
            {"characters": float(len(str(scene["narration"])))},
        )

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        del scene, seed
        raise RuntimeError("The showcase uses native semantic visuals, not image generation")

    def create_presenter(
        self, scene: dict[str, Any], *, narration_hash: str, seed: int
    ) -> GeneratedMedia | None:
        del scene, narration_hash, seed
        return None


def unit(identifier: str, role: str, **values: object) -> dict[str, object]:
    return {"id": identifier, "role": role, **values}


def beat(
    intent: str,
    family: str,
    focal: str,
    continuity: str,
    units: list[dict[str, object]],
    motions: list[str],
    *,
    title: str,
    support: str,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "semanticIntent": intent,
        "compositionFamily": family,
        "focalAnchor": focal,
        "continuityKey": continuity,
        "informationUnits": units,
        "attentionCue": focal,
        "motionIntent": motions,
        "textRoles": {
            "title": title,
            "support": support,
            "eyebrow": "AI VIDEO TUTORIAL GENERATOR",
        },
        "avoidRegions": [],
    }


def demo_catalog() -> tuple[Demo, ...]:
    presenter = Demo(
        slug="01-presenter-binary-search",
        title="Presenter lesson — Binary search",
        description="A teacher-led hook that quickly hands attention to a precise diagram.",
        presenter_scene_id="binary-hook",
        scenes=(
            {
                "id": "binary-hook",
                "type": "presenter-slide",
                "title": "Why can binary search skip half the list?",
                "narration": (
                    "Here is the trick behind binary search. When a sorted list tells us the middle "
                    "value is too small, every value to its left becomes impossible at once. One "
                    "comparison does not remove one option. It removes half the search space."
                ),
                "visualIntent": "Keep the question central while Maya introduces the halving insight.",
                "onScreenText": [
                    "Sorted data gives direction",
                    "One comparison removes half",
                ],
                "presenterName": "Maya — Mathematics Educator",
                "presenterPlacement": "picture_in_picture",
                "presenterProfileId": MAYA_PROFILE_ID,
                "visualBeat": beat(
                    "question",
                    "presenter",
                    "halving-question",
                    "binary-search",
                    [
                        unit("sorted", "principle", text="Sorted data gives direction"),
                        unit("half", "result", text="Discard one impossible half"),
                    ],
                    ["question-hold", "reveal-primary", "match-transition"],
                    title="Why can binary search skip half the list?",
                    support="One comparison removes an entire region",
                ),
            },
            {
                "id": "binary-diagram",
                "type": "diagram",
                "title": "One comparison removes half the work",
                "narration": (
                    "Suppose we want twenty three. The middle value is seventeen, so the target must "
                    "be on the right. The next middle value is twenty nine, so we move left. With just "
                    "two decisions, sixteen possible positions shrink to four."
                ),
                "visualIntent": "Trace a clean left-to-right elimination path through a sorted sequence.",
                "onScreenText": [
                    "2 · 5 · 8 · 12 · 17 · 20 · 23 · 29",
                    "17 → move right",
                    "29 → move left",
                    "23 found",
                ],
                "visualBeat": beat(
                    "demonstrate",
                    "diagram",
                    "target-23",
                    "binary-search",
                    [
                        unit("start", "ordered-sequence", values=[2, 5, 8, 12, 17, 20, 23, 29]),
                        unit("first", "state", text="17 → move right"),
                        unit("second", "state", text="29 → move left"),
                        unit("answer", "result", text="23 found"),
                    ],
                    ["trace-relationship", "transform-object", "emphasize-result"],
                    title="One comparison removes half the work",
                    support="Target 23 · 16 positions → 8 → 4",
                ),
            },
        ),
    )

    whiteboard = Demo(
        slug="02-whiteboard-bayes",
        title="Animated whiteboard — Bayes rule",
        description="A pencil-timed worked example that builds only as the explanation reaches it.",
        scenes=(
            {
                "id": "bayes-base-rate",
                "type": "whiteboard",
                "title": "Start with the base rates",
                "narration": (
                    "Imagine one hundred emails. Twenty are spam and eighty are safe. Our filter flags "
                    "ninety percent of the spam, but it also flags ten percent of the safe mail. Start "
                    "with counts, because counts make the conditional probability visible."
                ),
                "visualIntent": "Write the population and both filter rates one line at a time.",
                "onScreenText": ["100 emails", "20 spam", "80 safe", "Base rates first"],
                "visualBeat": beat(
                    "demonstrate",
                    "worked_example",
                    "base-rates",
                    "bayes-email-filter",
                    [
                        unit("population", "quantity", text="100 emails"),
                        unit("spam", "quantity", text="20 spam"),
                        unit("safe", "quantity", text="80 safe"),
                        unit("rule", "principle", text="Use counts before formulas"),
                    ],
                    ["reveal-primary", "trace-relationship"],
                    title="Start with the base rates",
                    support="Translate percentages into visible groups",
                ),
            },
            {
                "id": "bayes-posterior",
                "type": "whiteboard",
                "title": "Count the flagged emails",
                "narration": (
                    "The filter catches eighteen spam emails and eight safe emails. That makes twenty "
                    "six flagged messages in total. So when an email is flagged, the chance it is "
                    "actually spam is eighteen divided by twenty six, or about sixty nine percent."
                ),
                "visualIntent": "Draw the two flagged groups, combine them, then underline the posterior.",
                "onScreenText": ["18 flagged spam", "8 flagged safe", "26 flagged total", "18 ÷ 26 ≈ 69%"],
                "visualBeat": beat(
                    "resolve",
                    "worked_example",
                    "posterior-69",
                    "bayes-email-filter",
                    [
                        unit("true", "evidence", text="18 flagged spam"),
                        unit("false", "evidence", text="8 flagged safe"),
                        unit("total", "formula", text="18 + 8 = 26 flagged"),
                        unit("posterior", "answer", text="18 ÷ 26 ≈ 69%"),
                    ],
                    ["trace-relationship", "resolve-answer", "emphasize-result"],
                    title="Count the flagged emails",
                    support="A positive flag is evidence, not certainty",
                ),
            },
        ),
    )

    coding = Demo(
        slug="03-live-code-checkout",
        title="Live coding — Checkout totals",
        description="Code appears line by line with narration-linked focus and a verified numeric result.",
        scenes=(
            {
                "id": "checkout-transform",
                "type": "live-code",
                "title": "Transform each price, then reduce",
                "narration": (
                    "Let us calculate a checkout total without hiding the data flow. We start with four "
                    "prices. Map applies the ten percent discount to every item. Reduce then combines "
                    "those discounted values into one total, starting safely from zero."
                ),
                "visualIntent": "Type four JavaScript lines and focus each line as it is explained.",
                "onScreenText": [
                    "const prices = [12, 18, 9, 21];",
                    "const discounted = prices.map(p => p * 0.9);",
                    "const total = discounted.reduce((a, b) => a + b, 0);",
                    "console.log(total.toFixed(2)); // 54.00",
                ],
                "visualBeat": beat(
                    "demonstrate",
                    "document_focus",
                    "reduce-total",
                    "checkout-code",
                    [
                        unit("line1", "code", text="const prices = [12, 18, 9, 21];"),
                        unit("line2", "code", text="const discounted = prices.map(p => p * 0.9);"),
                        unit("line3", "code", text="const total = discounted.reduce((a, b) => a + b, 0);"),
                        unit("line4", "code", text="console.log(total.toFixed(2)); // 54.00"),
                    ],
                    ["reveal-primary", "evidence-focus", "trace-relationship"],
                    title="Transform each price, then reduce",
                    support="Readable data flow beats a clever one-liner",
                ),
            },
            {
                "id": "checkout-tax",
                "type": "live-code",
                "title": "Add tax without losing the intermediate values",
                "narration": (
                    "Now keep tax as its own named value. Eight percent of fifty four dollars is four "
                    "dollars and thirty two cents. Adding it gives fifty eight dollars and thirty two "
                    "cents. Named steps make the calculation easy to inspect, test, and change."
                ),
                "visualIntent": "Continue typing the tax calculation and reveal the final object last.",
                "onScreenText": [
                    "const tax = total * 0.08;",
                    "const final = total + tax;",
                    "console.log({ total, tax, final });",
                    "// { total: 54.00, tax: 4.32, final: 58.32 }",
                ],
                "visualBeat": beat(
                    "resolve",
                    "document_focus",
                    "final-total",
                    "checkout-code",
                    [
                        unit("line1", "code", text="const tax = total * 0.08;"),
                        unit("line2", "code", text="const final = total + tax;"),
                        unit("line3", "code", text="console.log({ total, tax, final });"),
                        unit("line4", "result", text="total 54.00 · tax 4.32 · final 58.32"),
                    ],
                    ["reveal-primary", "resolve-answer", "emphasize-result"],
                    title="Add tax without losing the intermediate values",
                    support="Named values stay inspectable",
                ),
            },
        ),
    )
    return presenter, whiteboard, coding


def prepare_presenter_config(
    output: Path, base_config: Path, portrait_hash: str
) -> Path:
    config = json.loads(base_config.resolve(strict=True).read_text(encoding="utf-8"))
    runtime_root = Path(str(config["runtimeRoot"])).resolve(strict=True)
    runtime_adapter = (
        runtime_root / "musetalk-runtime" / "worker" / "musetalk_v15_adapter.py"
    )
    source_adapter = (
        ROOT / "services" / "pipeline" / "scripts" / "musetalk_v15_adapter.py"
    ).resolve(strict=True)
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
    config["defaultProfileId"] = MAYA_PROFILE_ID
    config["profiles"] = [
        {
            "profileId": MAYA_PROFILE_ID,
            "portraitArtifactHash": portrait_hash,
            "subjectId": "fictional-synthetic-educator-maya-v2",
        }
    ]
    destination = output / "presenter-runtime-maya.json"
    destination.write_text(
        json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return destination


def proportional_words(text: str, duration_ms: int) -> list[dict[str, object]]:
    tokens = re.findall(r"\S+", text)
    if not tokens:
        return []
    start = min(160, max(0, duration_ms // 20))
    end = max(start + len(tokens), duration_ms - 100)
    span = end - start
    words: list[dict[str, object]] = []
    for index, token in enumerate(tokens):
        word_start = start + round(span * index / len(tokens))
        word_end = start + round(span * (index + 1) / len(tokens))
        words.append(
            {
                "token": token,
                "start_ms": word_start,
                "end_ms": max(word_start + 1, word_end),
            }
        )
    return words


def caption_cues(
    scene_id: str, text: str, duration_ms: int
) -> list[dict[str, object]]:
    words = re.findall(r"\S+", text)
    if not words:
        return []
    cues: list[dict[str, object]] = []
    size = 9
    for index in range(0, len(words), size):
        chunk = words[index : index + size]
        start = round(duration_ms * index / len(words))
        end = round(duration_ms * min(len(words), index + len(chunk)) / len(words))
        cues.append(
            {
                "cue_id": f"{scene_id}-{index // size + 1}",
                "start_ms": start,
                "end_ms": max(start + 1, end),
                "text": " ".join(chunk),
                "speaker": "Aria",
            }
        )
    return cues


def timestamp(milliseconds: int, *, srt: bool) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{millis:03d}"


def write_caption_sidecars(
    output: Path,
    stem: str,
    scenes: list[dict[str, Any]],
    captions: dict[str, list[dict[str, object]]],
) -> tuple[Path, Path, Path]:
    vtt_lines = ["WEBVTT", ""]
    srt_lines: list[str] = []
    transcript: list[str] = []
    offset_ms = 0
    cue_number = 1
    for scene in scenes:
        transcript.append(str(scene["narration"]))
        for cue in captions[scene["id"]]:
            start = offset_ms + int(cue["start_ms"])
            end = offset_ms + int(cue["end_ms"])
            text = str(cue["text"])
            vtt_lines.extend(
                [f"{timestamp(start, srt=False)} --> {timestamp(end, srt=False)}", text, ""]
            )
            srt_lines.extend(
                [str(cue_number), f"{timestamp(start, srt=True)} --> {timestamp(end, srt=True)}", text, ""]
            )
            cue_number += 1
        offset_ms += round(int(scene["durationTicks"]) / 240)
    vtt = output / f"{stem}.vtt"
    srt = output / f"{stem}.srt"
    text = output / f"{stem}.txt"
    vtt.write_text("\n".join(vtt_lines), encoding="utf-8")
    srt.write_text("\n".join(srt_lines), encoding="utf-8")
    text.write_text("\n\n".join(transcript) + "\n", encoding="utf-8")
    return vtt, srt, text


def claim_gpu_lock() -> None:
    state = GPU_LOCK.resolve(strict=True).read_text(encoding="utf-8-sig").strip().casefold()
    if state == "yes":
        raise RuntimeError("The shared GPU lock is already in use")
    if state not in {"no", ""}:
        raise RuntimeError(f"The shared GPU lock has an unknown state: {state!r}")
    GPU_LOCK.write_text("yes\n", encoding="utf-8")


def release_gpu_lock() -> None:
    GPU_LOCK.write_text("no\n", encoding="utf-8")


def remove_partial_tree(path: Path) -> None:
    """Remove only an incomplete generated demo, including read-only CAS copies."""

    def clear_readonly(function: Any, target: str, _error: BaseException) -> None:
        os.chmod(target, stat.S_IWRITE)
        function(target)

    shutil.rmtree(path, onexc=clear_readonly)


def create_demo(
    demo: Demo,
    output: Path,
    runtime_pack: Path,
    base_media: NvidiaMagpieMediaClient,
    presenter_config: Path,
    presenter_file: Path,
    recovered_presenter_video: Path | None,
    recovered_presenter_audio: Path | None,
) -> dict[str, Any]:
    demo_root = output / demo.slug
    demo_root.mkdir(parents=True)
    store = ProjectStore.create(demo_root / "project", name=demo.title)
    try:
        portrait_hash: str | None = None
        presenter_media = None
        if demo.presenter_scene_id:
            portrait = presenter_file.resolve(strict=True)
            portrait_artifact = store.add_artifact_bytes(
                portrait.read_bytes(),
                media_type="image/webp",
                original_name=portrait.name,
                metadata={
                    "origin": "generated",
                    "rightsStatus": "verified",
                    "licenseId": "LicenseRef-USER-OWNED",
                    "assetId": MAYA_PROFILE_ID,
                },
            )
            portrait_hash = portrait_artifact.hash
            selected_config = prepare_presenter_config(
                demo_root, presenter_config, portrait_hash
            )
            if recovered_presenter_video is None:
                presenter_media = load_local_presenter_media_client(
                    store, base_media, selected_config
                )

        scenes = [dict(scene) for scene in demo.scenes]
        narration_entries: list[dict[str, Any]] = []
        caption_map: dict[str, list[dict[str, object]]] = {}
        presenter_entries: list[dict[str, Any]] = []
        narration_cost = 0
        gpu_seconds = 0.0

        for index, scene in enumerate(scenes):
            is_recovered_presenter = (
                scene["id"] == demo.presenter_scene_id
                and recovered_presenter_video is not None
                and recovered_presenter_audio is not None
            )
            if is_recovered_presenter:
                recovered_audio = recovered_presenter_audio.resolve(strict=True).read_bytes()
                with wave.open(io.BytesIO(recovered_audio), "rb") as stream:
                    recovered_duration_ms = round(
                        stream.getnframes() * 1_000 / stream.getframerate()
                    )
                    recovered_sample_rate = stream.getframerate()
                    recovered_channels = stream.getnchannels()
                generated = GeneratedMedia(
                    recovered_audio,
                    "audio/wav",
                    f"{scene['id']}.magpie-aria-calm.wav",
                    "nvidia-nim",
                    "nvidia/magpie-tts-multilingual",
                    {
                        "origin": "generated",
                        "rightsStatus": "verified",
                        "licenseId": "LicenseRef-NVIDIA-AI-FOUNDATION-MODELS",
                        "durationMs": recovered_duration_ms,
                        "sampleRateHz": recovered_sample_rate,
                        "channels": recovered_channels,
                        "locale": "en-US",
                        "voiceId": MAGPIE_VOICE,
                        "voiceName": "Aria Calm",
                        "recoveredFromCompletedInferenceFrames": True,
                    },
                    0,
                    {"characters": float(len(str(scene["narration"])))},
                )
            else:
                generated = base_media.synthesize_narration(
                    scene, locale="en-US", seed=20260903 + index
                )
            narration_cost += int(generated.actual_cost_micros or 0)
            narration_artifact = store.add_artifact_bytes(
                generated.content,
                media_type=generated.media_type,
                original_name=generated.original_name,
                metadata={
                    **generated.metadata,
                    "providerId": generated.provider_id,
                    "modelRevision": generated.model_revision,
                    "voiceId": MAGPIE_VOICE,
                    "voiceName": "Aria Calm",
                },
            )
            duration_ms = int(generated.metadata["durationMs"])
            scene["durationTicks"] = (duration_ms + 250) * 240
            words = proportional_words(str(scene["narration"]), duration_ms)
            narration_entries.append(
                {
                    "sceneId": scene["id"],
                    "artifactHash": narration_artifact.hash,
                    "mediaType": generated.media_type,
                    "durationMs": duration_ms,
                    "words": words,
                    "alignment": {
                        "source": "duration-proportional",
                        "engine": "provider-neutral-fallback",
                        "alignedTokenRatio": 1.0,
                    },
                }
            )
            caption_map[str(scene["id"])] = caption_cues(
                str(scene["id"]), str(scene["narration"]), duration_ms
            )

            if scene["id"] == demo.presenter_scene_id:
                if is_recovered_presenter:
                    recovered_video = recovered_presenter_video.resolve(strict=True)
                    generated_presenter = GeneratedMedia(
                        recovered_video.read_bytes(),
                        "video/mp4",
                        recovered_video.name,
                        "local-runtime",
                        "musetalk-1.5+recovered-completed-frames",
                        {
                            "origin": "generated",
                            "rightsStatus": "verified",
                            "licenseId": "LicenseRef-USER-OWNED",
                            "recoveryTransform": "pinned-ffmpeg-frame-sequence-mux",
                        },
                        0,
                        {},
                    )
                else:
                    if presenter_media is None:
                        raise RuntimeError("Presenter media client was not initialized")
                    claim_gpu_lock()
                    try:
                        generated_presenter = presenter_media.create_presenter(
                            scene,
                            narration_hash=narration_artifact.hash,
                            seed=20260903 + index,
                        )
                    finally:
                        release_gpu_lock()
                presenter_artifact = store.add_artifact_bytes(
                    generated_presenter.content,
                    media_type=generated_presenter.media_type,
                    original_name=generated_presenter.original_name,
                    metadata=generated_presenter.metadata,
                )
                gpu_seconds += duration_ms / 1_000
                presenter_entries.append(
                    {
                        "sceneId": scene["id"],
                        "artifactHash": presenter_artifact.hash,
                        "activeDurationTicks": duration_ms * 240,
                        "direction": {
                            "placement": "picture_in_picture",
                            "fit": "cover",
                        },
                    }
                )

        renderer = create_production_renderer_client(
            store,
            repository_root=ROOT,
            runtime_manifest_path=ROOT / "runtime-manifest.json",
            node_path=runtime_pack / "node" / "node.exe",
            chromium_path=runtime_pack / "chromium" / "chrome.exe",
            ffmpeg_path=runtime_pack / "ffmpeg" / "ffmpeg.exe",
            ffprobe_path=runtime_pack / "ffmpeg" / "ffprobe.exe",
            renderer_cli_path=ROOT / "services" / "renderer" / "dist" / "src" / "cli.js",
            options=RendererOptions(
                codec="vp9",
                quality=30,
                concurrency=4,
                chunk_frames=150,
                timeout_seconds=7_200,
                caption_delivery_mode="sidecar",
            ),
        )
        visual_customization: dict[str, Any] | None = None
        if portrait_hash is not None:
            visual_customization = {
                "schemaVersion": 1,
                "assets": [
                    {
                        "assetId": MAYA_PROFILE_ID,
                        "artifactHash": portrait_hash,
                        "mediaType": "image/webp",
                        "role": "presenter-portrait",
                        "source": "starter",
                        "alt": "Maya, a fictional synthetic mathematics educator",
                        "fit": "cover",
                    }
                ],
                "presenter": {
                    "enabled": True,
                    "placement": "picture_in_picture",
                    "fit": "cover",
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
            }
        request = {
            "schemaVersion": 1,
            "generationId": str(uuid.uuid5(uuid.NAMESPACE_URL, demo.slug)),
            "timebase": TIMEBASE,
            "seed": 20260903,
            "locale": "en-US",
            "targets": [
                {"name": "showcase-720p", "width": 1280, "height": 720, "fps": 30}
            ],
            "scenes": scenes,
            "narration": narration_entries,
            "captions": {"captionsEnabled": True, "byScene": caption_map},
            "presenters": presenter_entries,
            "captionDeliveryMode": "sidecar",
            **(
                {"visualCustomization": visual_customization}
                if visual_customization is not None
                else {}
            ),
        }
        rendered = renderer.render(request)
        stem = f"ai-video-tutorial-generator-{demo.slug}"
        video = demo_root / f"{stem}.webm"
        video.write_bytes(rendered.content)
        vtt, srt, transcript = write_caption_sidecars(
            demo_root, stem, scenes, caption_map
        )
        duration_seconds = sum(int(scene["durationTicks"]) for scene in scenes) / TIMEBASE
        report = {
            "schemaVersion": 1,
            "title": demo.title,
            "description": demo.description,
            "durationSeconds": duration_seconds,
            "target": {"width": 1280, "height": 720, "fps": 30},
            "voice": {
                "provider": "nvidia-nim",
                "model": "nvidia/magpie-tts-multilingual",
                "voiceId": MAGPIE_VOICE,
                "name": "Aria Calm",
                "presenterMatched": demo.presenter_scene_id is not None,
            },
            "presenter": (
                {
                    "profileId": MAYA_PROFILE_ID,
                    "name": "Maya — Mathematics Educator",
                    "activeSeconds": gpu_seconds,
                }
                if demo.presenter_scene_id
                else None
            ),
            "narrationCostMicros": narration_cost,
            "files": {
                "video": str(video),
                "captionsVtt": str(vtt),
                "captionsSrt": str(srt),
                "transcript": str(transcript),
            },
            "rendererMetrics": rendered.metrics,
            "rendererManifest": rendered.manifest,
        }
        (demo_root / "showcase-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return report
    finally:
        store.close()


def write_research_ledger(output: Path) -> None:
    text = """# Showcase research ledger

The showcase uses short, segmented examples with signaling and narration-synchronized
visual changes. The presenter appears for the opening concept and then hands attention
to the instructional visual. Whiteboard strokes and live-code actions are paced from a
provider-neutral timing envelope, so the renderer behavior is not tied to one TTS vendor.

Primary evidence and implementation references:

- https://www.sciencedirect.com/science/article/pii/S0959475224002044
- https://link.springer.com/article/10.1007/s11423-024-10391-9
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11779760/
- https://arxiv.org/abs/2304.14042
- https://www.w3.org/WAI/media/av/
- https://tech.ebu.ch/fr/publications/r128
- https://support.google.com/youtube/answer/1722171?hl=en
- https://arxiv.org/abs/2303.00747
"""
    (output / "research-ledger.md").write_text(text, encoding="utf-8")


def main() -> int:
    options = arguments()
    output = options.output_root.resolve()
    if output.exists() and not options.resume:
        raise FileExistsError(f"Output root already exists: {output}")
    output.mkdir(parents=True, exist_ok=options.resume)
    if (options.recovered_presenter_video is None) != (
        options.recovered_presenter_audio is None
    ):
        raise ValueError(
            "Recovered presenter video and matching narration audio must be supplied together"
        )
    write_research_ledger(output)
    runtime_pack = options.runtime_pack.resolve(strict=True)
    secrets = credential_values(options.credentials_file)
    nvidia = secrets.get("nvidia_nim") or secrets.get("nvidia nim")
    if not nvidia:
        raise RuntimeError("The NVIDIA NIM credential is required")

    reports: list[dict[str, Any]] = []
    try:
        media = NvidiaMagpieMediaClient(nvidia)
        nvidia = ""

        # API-backed narration and CPU renderer work happen before the one GPU demo.
        demos = demo_catalog()
        for demo in (demos[1], demos[2], demos[0]):
            report_path = output / demo.slug / "showcase-report.json"
            if options.resume and report_path.is_file():
                reports.append(json.loads(report_path.read_text(encoding="utf-8")))
                continue
            partial_root = output / demo.slug
            if options.resume and partial_root.exists():
                partial_root.resolve(strict=True).relative_to(output.resolve(strict=True))
                remove_partial_tree(partial_root)
            reports.append(
                create_demo(
                    demo,
                    output,
                    runtime_pack,
                    media,
                    options.presenter_config,
                    options.presenter_file,
                    options.recovered_presenter_video,
                    options.recovered_presenter_audio,
                )
            )
        reports.sort(key=lambda item: str(item["files"]["video"]))
        (output / "showcase-index.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "product": "AI Video Tutorial Generator",
                    "created": "2026-09-03",
                    "demos": reports,
                },
                indent=2,
                ensure_ascii=False,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    finally:
        if GPU_LOCK.exists() and GPU_LOCK.read_text(encoding="utf-8-sig").strip().casefold() == "yes":
            release_gpu_lock()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
