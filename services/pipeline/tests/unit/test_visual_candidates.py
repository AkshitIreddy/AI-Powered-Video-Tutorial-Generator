from __future__ import annotations

import binascii
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.adapters import GeneratedMedia
from alystria.jobs.runtime import CancellationRequested
from alystria.project import ProjectStore
from alystria.project_assets import validate_selected_presenter_for_export
from alystria.visual_candidates import (
    VisualCandidateGenerationError,
    accept_visual_candidate,
    generate_visual_candidates,
    reject_visual_candidate,
)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _png(width: int = 8, height: int = 8) -> bytes:
    rows = b"".join(b"\x00" + b"\x66\x88\xaa" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(rows, 9))
        + _chunk(b"IEND", b"")
    )


class RasterClient:
    provider_id = "local-comfyui"
    model_revision = "stabilityai/stable-diffusion-xl-base-1.0"

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[dict[str, Any], int]] = []

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        self.calls.append((scene, seed))
        if self.fail:
            raise RuntimeError("reviewed local runtime is unavailable")
        return GeneratedMedia(
            _png(),
            "image/png",
            "provider-output.png",
            self.provider_id,
            self.model_revision,
            {
                "rightsStatus": "verified",
                "licenseId": "CreativeML-OpenRAIL++-M",
                "sourceUri": "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
                "recipeId": "sdxl-comfyui-v1",
            },
            0,
            {"images": 1},
        )

    def synthesize_narration(self, *_: Any, **__: Any) -> GeneratedMedia:
        raise AssertionError("visual candidate generation must not synthesize narration")

    def create_presenter(self, *_: Any, **__: Any) -> GeneratedMedia:
        raise AssertionError("portrait candidates use image generation, not animation")


class Context:
    job_id = "job_visual_candidate"
    task_key = "visual-candidate-task-key"

    def __init__(self) -> None:
        self.progress: list[tuple[float, str | None]] = []
        self.checkpoints: dict[str, dict[str, Any]] = {}

    def check_cancelled(self) -> None:
        return None

    def set_progress(self, progress: float, *, message: str | None = None) -> None:
        self.progress.append((progress, message))

    def provider_acceptance(self, idempotency_key: str) -> dict[str, Any] | None:
        return self.checkpoints.get(idempotency_key)

    def record_provider_acceptance(self, **values: Any) -> dict[str, Any]:
        key = values["idempotency_key"]
        checkpoint = {"result": values["result"], **values}
        self.checkpoints[key] = checkpoint
        return checkpoint


class CancellingContext(Context):
    def __init__(self) -> None:
        super().__init__()
        self.checks = 0

    def check_cancelled(self) -> None:
        self.checks += 1
        if self.checks >= 2:
            raise CancellationRequested("cancelled after provider response")


class UnknownRightsClient(RasterClient):
    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        generated = super().create_visual(scene, seed=seed)
        return GeneratedMedia(
            generated.content,
            generated.media_type,
            generated.original_name,
            generated.provider_id,
            generated.model_revision,
            {"rightsStatus": "unknown", "licenseId": "UNKNOWN"},
            generated.actual_cost_micros,
            generated.usage_units,
        )


class LocalRasterClient(RasterClient):
    provider_id = "local-runtime"


class RoutedRasterClient(RasterClient):
    provider_id = "approved:local-runtime+cloud-tts"

    def __init__(self, *, image_provider_ids: tuple[str, ...]) -> None:
        super().__init__()
        self._image_provider_ids = image_provider_ids
        self._local_fallback = LocalRasterClient()

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        self.calls.append((scene, seed))
        return self._local_fallback.create_visual(scene, seed=seed)


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "visual-candidates",
        name="Visual candidates",
        initial_snapshot={
            "id": "temporary",
            "title": "Visual candidates",
            "scenes": [
                {
                    "id": "scene-one",
                    "title": "Binary search",
                    "objective": "Show how the search interval shrinks.",
                    "narration": "The accepted narration must not change.",
                    "durationTicks": 2_400_000,
                }
            ],
            "customization": {"presenter": {"placement": "picture-in-picture"}},
        },
    )


def _params(head_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "expectedHeadRevisionId": head_id,
        "sceneId": "scene-one",
        "role": "scene",
        "instruction": "Use a clean sequence of narrowing intervals.",
        "preservationLocks": ["narration", "citations", "learningobjective", "timing"],
        "alternatives": 2,
        "seed": 1701,
        **overrides,
    }


def test_generation_promotes_real_images_without_replacing_accepted_scene(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        accepted_scene = head.snapshot["scenes"][0]
        client = RasterClient()
        context = Context()

        result = generate_visual_candidates(store, client, context, _params(head.revision_id))

        assert result["readyCount"] == 2
        assert result["acceptedSceneUnchanged"] is True
        assert [seed for _, seed in client.calls] == [1701, 1702]
        current = store.head_revision()
        assert current is not None
        assert current.snapshot["scenes"][0] == accepted_scene
        candidates = current.snapshot["sceneCandidates"]
        assert [item["status"] for item in candidates] == ["ready", "ready"]
        assert all(store.cas.verify(item["artifactHash"]) for item in candidates)
        assert all(item["mediaType"] == "image/png" for item in candidates)
        assert all(item["rights"]["exportEligible"] is True for item in candidates)
        assert all(item["acceptedSceneUnchanged"] is True for item in candidates)
        assert all("The accepted narration" not in item["prompt"] for item in candidates)
        assert all(scene["imageRole"] == "scene" for scene, _ in client.calls)


def test_scene_candidate_acceptance_is_explicit_and_undoable(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        generated = generate_visual_candidates(
            store, RasterClient(), Context(), _params(initial.revision_id)
        )
        generated_head = store.head_revision()
        assert generated_head is not None
        candidate_id = generated["candidateIds"][0]

        receipt = accept_visual_candidate(
            store,
            {
                "expectedHeadRevisionId": generated_head.revision_id,
                "candidateId": candidate_id,
            },
        )

        current = store.head_revision()
        assert current is not None
        accepted = next(
            item for item in current.snapshot["sceneCandidates"] if item["id"] == candidate_id
        )
        scene = current.snapshot["scenes"][0]
        assert accepted["status"] == "accepted"
        assert scene["visualAssetId"] == receipt["assetId"]
        assert scene["visualArtifactHash"] == receipt["artifactHash"]
        assert current.snapshot["mediaAssets"][0]["id"] == receipt["assetId"]
        assert current.snapshot["assetProvenance"][0]["exportEligible"] is True
        customization_asset = next(
            item
            for item in current.snapshot["customization"]["assets"]
            if item["id"] == receipt["assetId"]
        )
        assert customization_asset["source"] == "generated"
        assert customization_asset["sha256"] == receipt["artifactHash"]
        history = store.connection.execute(
            "SELECT undo_stack_json FROM revision_navigation WHERE singleton=1"
        ).fetchone()
        assert history is not None
        assert generated_head.revision_id in history["undo_stack_json"]


def test_presenter_acceptance_creates_synthetic_profile_and_selects_it(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        disabled_snapshot = initial.snapshot
        disabled_snapshot["customization"]["presenter"]["placement"] = "off"
        initial = store.create_revision(
            snapshot=disabled_snapshot,
            expected_head=initial.revision_id,
            message="Disable the presenter before candidate review",
        )
        client = RasterClient()
        generated = generate_visual_candidates(
            store,
            client,
            Context(),
            _params(
                initial.revision_id,
                role="presenter",
                instruction="calm South Asian woman teaching computer science",
                alternatives=1,
                preservationLocks=["narration", "citations", "learningobjective", "timing"],
            ),
        )
        generated_head = store.head_revision()
        assert generated_head is not None

        receipt = accept_visual_candidate(
            store,
            {
                "expectedHeadRevisionId": generated_head.revision_id,
                "candidateId": generated["candidateIds"][0],
            },
        )

        current = store.head_revision()
        assert current is not None
        profile = current.snapshot["presenterProfiles"][0]
        assert profile["identityType"] == "synthetic"
        assert profile["disclosureRequired"] is True
        assert profile["portraitArtifactId"] == receipt["assetId"]
        assert current.snapshot["selectedPresenterProfileId"] == profile["profileId"]
        assert current.snapshot["customization"]["presenter"]["assetId"] == receipt["assetId"]
        assert current.snapshot["customization"]["presenter"]["placement"] == "picture-in-picture"
        export_policy = validate_selected_presenter_for_export(
            store,
            current.snapshot,
            distribution_scope="publicCommercial",
        )
        assert export_policy is not None
        assert export_policy["portraitArtifactHash"] == receipt["artifactHash"]
        assert export_policy["identityType"] == "synthetic"
        assert "lips naturally closed" in client.calls[0][0]["visualIntent"]
        assert client.calls[0][0]["imageRole"] == "presenter"


def test_local_recipe_is_bounded_and_reaches_the_image_client(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = LocalRasterClient()
        recipe = {
            "model": "local/sdxl-base-1.0",
            "loras": ["local/sdxl-offset-lora-1.0"],
            "negativePrompt": "open mouth, text, watermark",
        }

        result = generate_visual_candidates(
            store,
            client,
            Context(),
            _params(head.revision_id, alternatives=1, imageRecipe=recipe),
        )

        assert client.calls[0][0]["imageRecipe"] == recipe
        assert result["candidates"][0]["imageRecipe"] == recipe


@pytest.mark.parametrize(
    "recipe",
    [
        {"model": "unreviewed/model"},
        {"loras": ["one", "two"]},
        {"loras": ["unreviewed/lora"]},
        {"negativePrompt": "x" * 2_049},
        {"sampler": "unreviewed"},
    ],
)
def test_unreviewed_local_recipe_controls_fail_before_generation(
    tmp_path: Path, recipe: dict[str, Any]
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = LocalRasterClient()
        with pytest.raises(ValueError, match="imageRecipe"):
            generate_visual_candidates(
                store,
                client,
                Context(),
                _params(head.revision_id, alternatives=1, imageRecipe=recipe),
            )
        assert client.calls == []


def test_local_recipe_cannot_be_silently_ignored_by_cloud_route(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = RasterClient()
        with pytest.raises(ValueError, match="selected local image route"):
            generate_visual_candidates(
                store,
                client,
                Context(),
                _params(
                    head.revision_id,
                    alternatives=1,
                    imageRecipe={"model": "local/sdxl-base-1.0", "loras": []},
                ),
            )
        assert client.calls == []


def test_local_recipe_survives_a_cloud_tts_media_wrapper(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = RoutedRasterClient(image_provider_ids=("local-runtime",))

        generate_visual_candidates(
            store,
            client,
            Context(),
            _params(
                head.revision_id,
                alternatives=1,
                imageRecipe={"model": "local/sdxl-base-1.0", "loras": []},
            ),
        )

        assert client.calls[0][0]["imageRecipe"]["model"] == "local/sdxl-base-1.0"


def test_cloud_image_route_cannot_use_local_fallback_recipe(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = RoutedRasterClient(image_provider_ids=("cloudflare-workers-ai",))
        with pytest.raises(ValueError, match="selected local image route"):
            generate_visual_candidates(
                store,
                client,
                Context(),
                _params(
                    head.revision_id,
                    alternatives=1,
                    imageRecipe={"model": "local/sdxl-base-1.0", "loras": []},
                ),
            )
        assert client.calls == []


@pytest.mark.parametrize(
    ("role", "lock"),
    [("scene", "assets"), ("presenter", "presenter")],
)
def test_conflicting_preservation_requests_fail_before_provider_use(
    tmp_path: Path, role: str, lock: str
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        client = RasterClient()
        with pytest.raises(ValueError, match="Cannot regenerate"):
            generate_visual_candidates(
                store,
                client,
                Context(),
                _params(head.revision_id, role=role, preservationLocks=[lock]),
            )
        assert client.calls == []
        assert store.head_revision().revision_id == head.revision_id


def test_provider_failure_is_durable_and_never_autoaccepted(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None

        with pytest.raises(VisualCandidateGenerationError, match="runtime is unavailable"):
            generate_visual_candidates(
                store,
                RasterClient(fail=True),
                Context(),
                _params(head.revision_id, alternatives=1),
            )

        current = store.head_revision()
        assert current is not None
        assert current.revision_id != head.revision_id
        failure = current.snapshot["sceneCandidates"][0]
        assert failure["status"] == "failed"
        assert failure["acceptedSceneUnchanged"] is True
        assert "visualAssetId" not in current.snapshot["scenes"][0]


def test_cancellation_after_provider_response_does_not_promote_or_revise(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None

        with pytest.raises(CancellationRequested):
            generate_visual_candidates(
                store,
                RasterClient(),
                CancellingContext(),
                _params(head.revision_id, alternatives=1),
            )

        assert store.head_revision().revision_id == head.revision_id
        artifact_count = store.connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
        assert artifact_count == 0


def test_unknown_rights_candidate_can_be_reviewed_but_not_accepted(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        generated = generate_visual_candidates(
            store,
            UnknownRightsClient(),
            Context(),
            _params(head.revision_id, alternatives=1),
        )
        generated_head = store.head_revision()
        assert generated_head is not None
        candidate = generated["candidates"][0]
        assert candidate["status"] == "ready"
        assert candidate["rights"]["exportEligible"] is False

        with pytest.raises(ValueError, match="rights source"):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": generated_head.revision_id,
                    "candidateId": candidate["id"],
                },
            )
        assert store.head_revision().revision_id == generated_head.revision_id


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("provider", "unreviewed-provider", "immutable artifact registration"),
        ("prompt", "A substituted prompt", "immutable prompt hash"),
    ],
)
def test_acceptance_rejects_snapshot_metadata_tampering(
    tmp_path: Path, field: str, value: str, message: str
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        generated = generate_visual_candidates(
            store,
            RasterClient(),
            Context(),
            _params(head.revision_id, alternatives=1),
        )
        generated_head = store.head_revision()
        assert generated_head is not None
        tampered = generated_head.snapshot
        tampered["sceneCandidates"][0][field] = value
        edited = store.create_revision(
            snapshot=tampered,
            expected_head=generated_head.revision_id,
            message="Simulated generic snapshot edit",
        )

        with pytest.raises(ValueError, match=message):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": edited.revision_id,
                    "candidateId": generated["candidateIds"][0],
                },
            )
        assert store.head_revision().revision_id == edited.revision_id


def test_reject_and_stale_accept_preserve_the_current_scene(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        generated = generate_visual_candidates(
            store, RasterClient(), Context(), _params(initial.revision_id, alternatives=1)
        )
        generated_head = store.head_revision()
        assert generated_head is not None
        candidate_id = generated["candidateIds"][0]

        rejected = reject_visual_candidate(
            store,
            {
                "expectedHeadRevisionId": generated_head.revision_id,
                "candidateId": candidate_id,
                "reason": "The framing leaves too little negative space.",
            },
        )
        assert rejected["status"] == "rejected"
        assert "visualAssetId" not in store.head_revision().snapshot["scenes"][0]
        with pytest.raises(ValueError, match="became stale"):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": generated_head.revision_id,
                    "candidateId": candidate_id,
                },
            )
