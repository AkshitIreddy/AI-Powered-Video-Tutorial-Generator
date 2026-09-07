from __future__ import annotations

import base64
import binascii
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.adapters import DeterministicMediaClient
from alystria.gpu_guard import GpuExecutionGuard, GpuGuardBusyError
from alystria.providers.comfyui_local import (
    COMFYUI_LOCAL_PROVIDER_ID,
    COMFYUI_RUNTIME_REVISION,
    FLUX_KLEIN_MODEL_ID,
    SDXL_BUNDLE,
    SDXL_MODEL_ID,
    SDXL_OFFSET_LORA_FILENAME,
    SDXL_OFFSET_LORA_ID,
    SDXL_OFFSET_LORA_STRENGTH,
    SDXL_RECIPE_ID,
    SDXL_SCENE_RECIPE_ID,
    Z_IMAGE_MODEL_ID,
    ComfyApi,
    ComfyBundleInstaller,
    ComfyGenerationMediaClient,
    ComfyUiLocalAdapter,
    ComfyUiRuntime,
    DownloadFile,
    _download_verified,
    build_sdxl_workflow,
)
from alystria.providers.errors import FailureCode, ProviderFailure
from alystria.providers.types import (
    DataBoundary,
    ImageRequest,
    RequestContext,
    RetentionMode,
)


class FakeApi:
    def __init__(self, output_name: str) -> None:
        self.output_name = output_name
        self.requests: list[tuple[str, str, dict[str, Any] | None]] = []

    def json(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.requests.append((method, path, body))
        if path == "/prompt":
            return {"prompt_id": "prompt-1"}
        if path == "/history/prompt-1":
            return {
                "prompt-1": {
                    "status": {"status_str": "success"},
                    "outputs": {
                        "7": {
                            "images": [
                                {
                                    "filename": self.output_name,
                                    "subfolder": "alystria",
                                    "type": "output",
                                }
                            ]
                        }
                    },
                }
            }
        raise AssertionError(path)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def png(width: int, height: int) -> bytes:
    rows = b"".join(b"\x00" + b"\x66\x88\xaa" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(rows, 9))
        + _chunk(b"IEND", b"")
    )


def context() -> RequestContext:
    return RequestContext(
        idempotency_key="local-sdxl-1",
        approved_provider_id=COMFYUI_LOCAL_PROVIDER_ID,
        approved_boundary=DataBoundary.LOCAL,
        approved_retention=RetentionMode.LOCAL_ONLY,
    )


def test_pinned_bundles_separate_executable_recipe_from_download_candidates() -> None:
    assert SDXL_BUNDLE.recipe_id == SDXL_RECIPE_ID
    assert SDXL_BUNDLE.files[0].size == 6_938_078_334
    assert SDXL_BUNDLE.files[0].sha256 == (
        "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b"
    )
    assert COMFYUI_RUNTIME_REVISION == "8f40b43e0204d5b9780f3e9618e140e929e80594"


def test_sdxl_graph_preserves_prompt_seed_and_reviewed_sampler() -> None:
    request = ImageRequest(
        "front-facing presenter",
        SDXL_MODEL_ID,
        aspect_ratio="1:1",
        negative_prompt="open mouth",
        seed=17,
    )
    graph = build_sdxl_workflow(request, seed=17, width=1024, height=1024)

    assert graph["1"]["inputs"]["ckpt_name"] == "sd_xl_base_1.0.safetensors"
    assert graph["2"]["inputs"]["text"] == "front-facing presenter"
    assert graph["3"]["inputs"]["text"] == "open mouth"
    assert graph["5"]["inputs"] == {
        "seed": 17,
        "steps": 25,
        "cfg": 6.5,
        "sampler_name": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": 1.0,
        "model": ["1", 0],
        "positive": ["2", 0],
        "negative": ["3", 0],
        "latent_image": ["4", 0],
    }


def test_sdxl_graph_loads_only_pinned_official_offset_lora() -> None:
    request = ImageRequest(
        "front-facing presenter",
        SDXL_MODEL_ID,
        aspect_ratio="1:1",
        seed=17,
        loras=(SDXL_OFFSET_LORA_ID,),
    )

    graph = build_sdxl_workflow(request, seed=17, width=1024, height=1024)

    assert graph["8"] == {
        "class_type": "LoraLoader",
        "inputs": {
            "model": ["1", 0],
            "clip": ["1", 1],
            "lora_name": SDXL_OFFSET_LORA_FILENAME,
            "strength_model": SDXL_OFFSET_LORA_STRENGTH,
            "strength_clip": SDXL_OFFSET_LORA_STRENGTH,
        },
    }
    assert graph["2"]["inputs"]["clip"] == ["8", 1]
    assert graph["3"]["inputs"]["clip"] == ["8", 1]
    assert graph["5"]["inputs"]["model"] == ["8", 0]


def test_adapter_rejects_unreviewed_lora(tmp_path: Path) -> None:
    adapter = ComfyUiLocalAdapter(FakeApi("unused.png"), tmp_path)  # type: ignore[arg-type]

    with pytest.raises(ProviderFailure, match="only the pinned official") as raised:
        adapter.invoke(
            ImageRequest("presenter", SDXL_MODEL_ID, loras=("untrusted/arbitrary",)),
            context(),
        )

    assert raised.value.code is FailureCode.UNSUPPORTED_CAPABILITY


def test_adapter_returns_real_local_png_with_recipe_provenance(tmp_path: Path) -> None:
    output = tmp_path / "output" / "alystria" / "portrait.png"
    output.parent.mkdir(parents=True)
    content = png(1024, 1024)
    output.write_bytes(content)
    api = FakeApi(output.name)
    adapter = ComfyUiLocalAdapter(api, tmp_path, poll_interval_seconds=0)  # type: ignore[arg-type]

    result = adapter.invoke(
        ImageRequest("front-facing presenter", SDXL_MODEL_ID, aspect_ratio="1:1", seed=17),
        context(),
    )

    asset = result.value.assets[0]
    assert base64.b64decode(asset.data_base64 or "") == content
    assert (asset.width, asset.height, asset.media_type) == (1024, 1024, "image/png")
    assert result.value.metadata["recipeId"] == SDXL_RECIPE_ID
    assert result.value.metadata["seed"] == 17
    assert result.usage.actual_cost_micros == 0


@pytest.mark.parametrize("model", [FLUX_KLEIN_MODEL_ID, Z_IMAGE_MODEL_ID])
def test_downloadable_candidate_cannot_be_invoked_as_verified(model: str, tmp_path: Path) -> None:
    adapter = ComfyUiLocalAdapter(FakeApi("unused.png"), tmp_path)  # type: ignore[arg-type]
    with pytest.raises(ProviderFailure, match=r"downloadable.*no hardware-verified") as raised:
        adapter.invoke(ImageRequest("presenter", model), context())
    assert raised.value.code is FailureCode.UNSUPPORTED_CAPABILITY


def test_api_rejects_non_loopback_and_paths() -> None:
    with pytest.raises(ValueError, match="loopback"):
        ComfyApi("https://example.com:8188")
    with pytest.raises(ValueError, match="path"):
        ComfyApi("http://127.0.0.1:8188/untrusted")


def test_verified_existing_download_is_reused_without_network(tmp_path: Path) -> None:
    content = b"verified-model"
    item = DownloadFile(
        "https://example.invalid/model.safetensors",
        "models/checkpoints/model.safetensors",
        len(content),
        __import__("hashlib").sha256(content).hexdigest(),
    )
    destination = tmp_path / item.relative_path
    destination.parent.mkdir(parents=True)
    destination.write_bytes(content)
    progress: list[tuple[str, int, int]] = []

    result = _download_verified(item, tmp_path, lambda *values: progress.append(values))

    assert result == destination
    assert result.read_bytes() == content
    assert progress == [("model.safetensors", len(content), len(content))]


def test_preflight_requires_exact_hash_even_when_size_matches(tmp_path: Path) -> None:
    comfy = tmp_path / "ComfyUI"
    (comfy / "models" / "checkpoints").mkdir(parents=True)
    (comfy / "main.py").write_text("", encoding="utf-8")
    target = comfy / SDXL_BUNDLE.files[0].relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"wrong")

    preflight = ComfyBundleInstaller(tmp_path).preflight(SDXL_MODEL_ID)

    assert preflight["executable"] is False
    assert preflight["files"][0]["verified"] is False


def test_runtime_releases_gpu_lock_when_hidden_process_cannot_start(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gpu_lock = tmp_path / "gpu use.txt"
    gpu_lock.write_text("no\n", encoding="utf-8")
    runtime = ComfyUiRuntime(tmp_path / "runtime", gpu_lock=gpu_lock)
    monkeypatch.setattr(
        ComfyBundleInstaller,
        "preflight",
        lambda *_args: {"executable": True},
    )
    def fail_start(*_args: object, **_kwargs: object) -> None:
        assert gpu_lock.read_text(encoding="utf-8") == "yes\n"
        raise OSError("launch failed")

    monkeypatch.setattr("alystria.providers.comfyui_local.subprocess.Popen", fail_start)

    with pytest.raises(OSError, match="launch failed"):
        runtime.__enter__()

    assert gpu_lock.read_text(encoding="utf-8") == "no\n"


def test_runtime_does_not_reset_busy_gpu_or_claim_before_preflight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gpu_lock = tmp_path / "gpu use.txt"
    gpu_lock.write_text("yes\n", encoding="utf-8")
    runtime = ComfyUiRuntime(tmp_path / "runtime", gpu_lock=gpu_lock)

    monkeypatch.setattr(
        ComfyBundleInstaller,
        "preflight",
        lambda *_args: {"executable": False},
    )
    with pytest.raises(RuntimeError, match="not installed"):
        runtime.__enter__()
    assert gpu_lock.read_text(encoding="utf-8") == "yes\n"

    monkeypatch.setattr(
        ComfyBundleInstaller,
        "preflight",
        lambda *_args: {"executable": True},
    )
    monkeypatch.setattr(
        "alystria.providers.comfyui_local.subprocess.Popen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("busy GPU must fail before process launch")
        ),
    )
    with pytest.raises(GpuGuardBusyError, match="already claimed"):
        runtime.__enter__()
    assert gpu_lock.read_text(encoding="utf-8") == "yes\n"


def test_runtime_preserves_gpu_claim_when_process_cannot_be_stopped(tmp_path: Path) -> None:
    gpu_lock = tmp_path / "gpu use.txt"
    gpu_lock.write_text("no\n", encoding="utf-8")
    runtime = ComfyUiRuntime(tmp_path / "runtime", gpu_lock=gpu_lock)

    class UnstoppableProcess:
        def poll(self) -> None:
            return None

        def terminate(self) -> None:
            raise OSError("terminate failed")

    guard = GpuExecutionGuard(gpu_lock, owner="comfyui-local-test")
    guard.__enter__()
    runtime._gpu_guard = guard
    runtime.process = UnstoppableProcess()  # type: ignore[assignment]

    with pytest.raises(OSError, match="terminate failed"):
        runtime.__exit__(None, None, None)

    assert gpu_lock.read_text(encoding="utf-8") == "yes\n"


def test_generation_media_client_executes_presenter_recipe_seed_and_lora(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "output" / "alystria" / "teacher.png"
    output.parent.mkdir(parents=True)
    output.write_bytes(png(1024, 1024))
    lora = tmp_path / "models" / "loras" / SDXL_OFFSET_LORA_FILENAME
    lora.parent.mkdir(parents=True)
    lora.write_bytes(b"installed")
    api = FakeApi(output.name)
    adapter = ComfyUiLocalAdapter(api, tmp_path, poll_interval_seconds=0)  # type: ignore[arg-type]
    runtime_calls: list[tuple[Path, int, Path]] = []

    class FakeRuntime:
        def __enter__(self) -> ComfyUiLocalAdapter:
            return adapter

        def __exit__(self, *_args: object) -> None:
            return None

    def runtime_factory(
        runtime_root: Path, *, port: int, gpu_lock: Path
    ) -> FakeRuntime:
        runtime_calls.append((runtime_root, port, gpu_lock))
        return FakeRuntime()

    monkeypatch.setattr(
        "alystria.providers.comfyui_local.ComfyUiRuntime",
        runtime_factory,
    )
    gpu_lock = tmp_path / "gpu use.txt"
    gpu_lock.write_text("no\n", encoding="utf-8")
    client = ComfyGenerationMediaClient(
        DeterministicMediaClient(),
        tmp_path,
        gpu_lock=gpu_lock,
        port=9123,
    )

    media = client.create_visual(
        {
            "id": "teacher",
            "title": "Friendly teacher",
            "visualIntent": "Front-facing teacher",
            "imageRole": "presenter",
            "imageRecipe": {
                "model": SDXL_MODEL_ID,
                "loras": [SDXL_OFFSET_LORA_ID],
                "negativePrompt": "open mouth",
            },
        },
        seed=91,
    )

    queued = api.requests[0][2]
    assert queued is not None
    graph = queued["prompt"]
    assert graph["4"]["inputs"] == {"width": 1024, "height": 1024, "batch_size": 1}
    assert graph["5"]["inputs"]["seed"] == 91
    assert graph["8"]["inputs"]["lora_name"] == SDXL_OFFSET_LORA_FILENAME
    assert media.content == output.read_bytes()
    assert media.media_type == "image/png"
    assert media.metadata["seed"] == 91
    assert media.metadata["recipeId"] == SDXL_RECIPE_ID
    assert media.metadata["loras"][0]["id"] == SDXL_OFFSET_LORA_ID
    assert media.metadata["rightsStatus"] == "verified"
    assert media.metadata["licenseId"] == "CreativeML Open RAIL++-M"
    assert runtime_calls == [(tmp_path.resolve(), 9123, gpu_lock.resolve())]

    output.write_bytes(png(1344, 768))
    scene_media = client.create_visual(
        {
            "id": "lesson-scene",
            "title": "Binary search",
            "visualIntent": "A row of cards narrowing to one interval",
            "imageRole": "scene",
            "imageRecipe": {"model": SDXL_MODEL_ID, "loras": []},
        },
        seed=92,
    )
    assert scene_media.metadata["recipeId"] == SDXL_SCENE_RECIPE_ID
