"""Pinned local ComfyUI installation and SDXL image generation.

The module deliberately separates two facts that product copy often conflates:
an exact model bundle can be downloadable while its workflow is still not
hardware-verified. Only the SDXL recipe below is executable. FLUX.2 Klein and
Z-Image retain fully verified download identities but fail closed at invocation
until their exact workflows pass on the shipping Windows runtime.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import http.client
import json
import os
import re
import subprocess
import time
import urllib.request
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from alystria.gpu_guard import GpuExecutionGuard

from .errors import FailureCode, ProviderFailure
from .types import (
    Capability,
    CostEstimate,
    DataBoundary,
    DataPolicy,
    ImageRequest,
    MediaAsset,
    MediaOutput,
    ProviderDescriptor,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    RetentionMode,
    Usage,
)

if TYPE_CHECKING:
    from alystria.generation.adapters import GeneratedMedia, GenerationMediaClient

COMFYUI_LOCAL_PROVIDER_ID = "comfyui-local"
COMFYUI_RUNTIME_TAG = "v0.9.2"
COMFYUI_RUNTIME_REVISION = "8f40b43e0204d5b9780f3e9618e140e929e80594"
COMFYUI_PORTABLE_URL = (
    "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.9.2/"
    "ComfyUI_windows_portable_nvidia.7z"
)
COMFYUI_PORTABLE_SIZE = 1_803_412_624
COMFYUI_PORTABLE_SHA256 = "3a0707fbf1cf5dc8b5f1ab3abe8af104deffcb1acc27b8d27c484715dd41f4c5"
SDXL_MODEL_ID = "local/sdxl-base-1.0"
SDXL_RECIPE_ID = "comfy-sdxl-1.0-portrait-v1"
SDXL_SCENE_RECIPE_ID = "comfy-sdxl-1.0-scene-v1"
SDXL_OFFSET_LORA_ID = "local/sdxl-offset-lora-1.0"
SDXL_OFFSET_LORA_FILENAME = "sd_xl_offset_example-lora_1.0.safetensors"
SDXL_OFFSET_LORA_STRENGTH = 0.35
FLUX_KLEIN_MODEL_ID = "local/flux.2-klein-4b-fp8"
Z_IMAGE_MODEL_ID = "local/z-image-turbo-int8"

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_MODEL_FILE = re.compile(r"[A-Za-z0-9_.-]{1,180}\Z")


@dataclass(frozen=True, slots=True)
class DownloadFile:
    url: str
    relative_path: str
    size: int
    sha256: str


@dataclass(frozen=True, slots=True)
class ComfyBundle:
    model_id: str
    recipe_id: str | None
    license: str
    source_url: str
    status: str
    files: tuple[DownloadFile, ...]


SDXL_BUNDLE = ComfyBundle(
    SDXL_MODEL_ID,
    SDXL_RECIPE_ID,
    "CreativeML Open RAIL++-M",
    "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
    "hardware-verified-12gb-windows",
    (
        DownloadFile(
            (
                "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/"
                "resolve/462165984030d82259a11f4367a4eed129e94a7b/"
                "sd_xl_base_1.0.safetensors?download=true"
            ),
            "models/checkpoints/sd_xl_base_1.0.safetensors",
            6_938_078_334,
            "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
        ),
        DownloadFile(
            (
                "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/"
                "resolve/462165984030d82259a11f4367a4eed129e94a7b/"
                "sd_xl_offset_example-lora_1.0.safetensors?download=true"
            ),
            "models/loras/sd_xl_offset_example-lora_1.0.safetensors",
            49_553_604,
            "4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f",
        ),
    ),
)

FLUX_KLEIN_BUNDLE = ComfyBundle(
    FLUX_KLEIN_MODEL_ID,
    None,
    "Apache-2.0",
    "https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8",
    "12gb-offload-candidate",
    (
        DownloadFile(
            (
                "https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/"
                "resolve/5b4408e59397a4a37ccb46afe426d8ed86379441/"
                "flux-2-klein-4b-fp8.safetensors?download=true"
            ),
            "models/diffusion_models/flux-2-klein-4b-fp8.safetensors",
            4_070_624_520,
            "97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6",
        ),
        DownloadFile(
            (
                "https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/"
                "resolve/5f526678002e43af5551dadb73ce2e8c91b43afe/"
                "split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors?download=true"
            ),
            "models/text_encoders/qwen_3_4b_fp4_flux2.safetensors",
            3_848_213_998,
            "3eab03a77adb0ee5304a4e677d5c10ac22f9049c1d7c894adca4f8bb39206ca8",
        ),
        DownloadFile(
            (
                "https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/"
                "resolve/5f526678002e43af5551dadb73ce2e8c91b43afe/"
                "split_files/vae/flux2-vae.safetensors?download=true"
            ),
            "models/vae/flux2-vae.safetensors",
            336_211_292,
            "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3",
        ),
    ),
)

Z_IMAGE_BUNDLE = ComfyBundle(
    Z_IMAGE_MODEL_ID,
    None,
    "Apache-2.0",
    "https://huggingface.co/Comfy-Org/z_image_turbo",
    "12gb-offload-candidate",
    (
        DownloadFile(
            (
                "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/"
                "08d04455279082882deaabc8d0d09fc914c071e1/split_files/"
                "diffusion_models/z_image_turbo_int8_convrot.safetensors?download=true"
            ),
            "models/diffusion_models/z_image_turbo_int8_convrot.safetensors",
            6_201_001_296,
            "be517ebd47c912a5626a588e1aeea43e6be4a43c0cdcd2b48a2a780d9f358635",
        ),
        DownloadFile(
            (
                "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/"
                "08d04455279082882deaabc8d0d09fc914c071e1/split_files/"
                "text_encoders/qwen_3_4b_fp4_mixed.safetensors?download=true"
            ),
            "models/text_encoders/qwen_3_4b_fp4_mixed.safetensors",
            3_479_416_193,
            "7ca32dcf07dfe7692945d80fff86e3a74cb83c6206b9b223ac6836b939bb85d6",
        ),
        DownloadFile(
            (
                "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/"
                "08d04455279082882deaabc8d0d09fc914c071e1/split_files/vae/"
                "ae.safetensors?download=true"
            ),
            "models/vae/ae.safetensors",
            335_304_388,
            "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
        ),
    ),
)

COMFY_BUNDLES = {
    bundle.model_id: bundle
    for bundle in (SDXL_BUNDLE, FLUX_KLEIN_BUNDLE, Z_IMAGE_BUNDLE)
}

COMFYUI_LOCAL_DESCRIPTOR = ProviderDescriptor(
    provider_id=COMFYUI_LOCAL_PROVIDER_ID,
    display_name="ComfyUI local",
    capabilities=frozenset({Capability.IMAGE_GENERATION}),
    data_policy=DataPolicy(
        DataBoundary.LOCAL,
        RetentionMode.LOCAL_ONLY,
        ("local",),
        stores_by_default=False,
        training_use=False,
    ),
    catalog_version="comfyui-local-2026-09-05",
    last_verified_at="2026-09-05",
    docs_url="https://github.com/Comfy-Org/ComfyUI",
    models=(SDXL_MODEL_ID,),
    supports_cancellation=False,
)


class ComfyBundleInstaller:
    """Install only allowlisted, content-addressed runtime and model files."""

    def __init__(
        self,
        runtime_root: Path,
        *,
        progress: Callable[[str, int, int], None] | None = None,
    ) -> None:
        self.runtime_root = runtime_root.resolve()
        self.progress = progress or (lambda _name, _done, _total: None)

    @property
    def comfy_root(self) -> Path:
        manual = self.runtime_root / "ComfyUI"
        portable = self.runtime_root / "ComfyUI_windows_portable" / "ComfyUI"
        if (manual / "main.py").is_file():
            return manual
        if (portable / "main.py").is_file():
            return portable
        return portable

    @property
    def python_executable(self) -> Path:
        manual = self.runtime_root / "venv" / "Scripts" / "python.exe"
        portable = self.runtime_root / "ComfyUI_windows_portable" / "python_embeded" / "python.exe"
        return manual if manual.is_file() else portable

    def install_runtime(self, *, extractor: str = "tar.exe") -> Path:
        if self.python_executable.is_file() and (self.comfy_root / "main.py").is_file():
            return self.comfy_root
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        archive = self.runtime_root / f"ComfyUI-{COMFYUI_RUNTIME_TAG}-nvidia.7z"
        _download_verified(
            DownloadFile(
                COMFYUI_PORTABLE_URL,
                archive.name,
                COMFYUI_PORTABLE_SIZE,
                COMFYUI_PORTABLE_SHA256,
            ),
            self.runtime_root,
            self.progress,
        )
        listing = subprocess.run(
            (extractor, "-tf", str(archive)),
            cwd=self.runtime_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=300,
            shell=False,
            check=False,
        )
        if listing.returncode != 0:
            raise RuntimeError("The verified ComfyUI archive could not be inspected")
        members = [line.strip().replace("\\", "/") for line in listing.stdout.splitlines()]
        if not members or any(
            member.startswith(("/", "../")) or "/../" in member or ":" in member
            for member in members
        ):
            raise RuntimeError("The ComfyUI archive contains an unsafe member path")
        extracted = subprocess.run(
            (extractor, "-xf", str(archive)),
            cwd=self.runtime_root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=1_800,
            shell=False,
            check=False,
        )
        if extracted.returncode != 0:
            raise RuntimeError("The verified ComfyUI archive could not be extracted")
        if not self.python_executable.is_file() or not (self.comfy_root / "main.py").is_file():
            raise RuntimeError("The extracted ComfyUI runtime is incomplete")
        return self.comfy_root

    def install_bundle(self, model_id: str) -> dict[str, Any]:
        try:
            bundle = COMFY_BUNDLES[model_id]
        except KeyError as error:
            raise ValueError(f"Unknown local image bundle: {model_id}") from error
        if not (self.comfy_root / "main.py").is_file():
            raise RuntimeError("Install the pinned ComfyUI runtime before a model bundle")
        installed = []
        for file in bundle.files:
            installed.append(
                str(_download_verified(file, self.comfy_root, self.progress))
            )
        manifest = {
            "modelId": bundle.model_id,
            "recipeId": bundle.recipe_id,
            "status": bundle.status,
            "license": bundle.license,
            "runtimeRevision": COMFYUI_RUNTIME_REVISION,
            "files": [
                {"path": file.relative_path, "size": file.size, "sha256": file.sha256}
                for file in bundle.files
            ],
        }
        manifest_root = self.runtime_root / "manifests"
        manifest_root.mkdir(parents=True, exist_ok=True)
        manifest_path = manifest_root / f"{_safe_manifest_name(model_id)}.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return {**manifest, "manifestPath": str(manifest_path), "installed": installed}

    def preflight(self, model_id: str) -> dict[str, Any]:
        bundle = COMFY_BUNDLES.get(model_id)
        if bundle is None:
            raise ValueError(f"Unknown local image bundle: {model_id}")
        files = []
        for item in bundle.files:
            path = _safe_destination(self.comfy_root, item.relative_path)
            valid = path.is_file() and path.stat().st_size == item.size
            if valid:
                valid = _sha256(path) == item.sha256
            files.append({"path": str(path), "verified": valid})
        runtime_ready = self.python_executable.is_file() and (
            self.comfy_root / "main.py"
        ).is_file()
        return {
            "runtimeReady": runtime_ready,
            "modelId": model_id,
            "recipeId": bundle.recipe_id,
            "executable": runtime_ready
            and bundle.recipe_id == SDXL_RECIPE_ID
            and all(item["verified"] for item in files[:1]),
            "files": files,
        }


class ComfyApi:
    """Minimal, loopback-only ComfyUI API boundary."""

    def __init__(self, endpoint: str, *, timeout_seconds: float = 30) -> None:
        parsed = urlsplit(endpoint)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"}:
            raise ValueError("ComfyUI endpoint must use loopback HTTP")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("ComfyUI endpoint must not contain a path, query, or fragment")
        self.host = parsed.hostname
        self.port = parsed.port or 8188
        self.timeout_seconds = timeout_seconds

    def json(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not path.startswith("/") or ".." in path:
            raise ValueError("ComfyUI API path is invalid")
        connection = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout_seconds)
        encoded = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        try:
            connection.request(
                method,
                path,
                body=encoded,
                headers={"Content-Type": "application/json"} if encoded else {},
            )
            response = connection.getresponse()
            payload = response.read(2_000_001)
            if len(payload) > 2_000_000:
                raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI response is too large")
            if not 200 <= response.status < 300:
                raise ProviderFailure(
                    FailureCode.PROVIDER_ERROR,
                    f"ComfyUI returned HTTP {response.status}",
                    provider_id=COMFYUI_LOCAL_PROVIDER_ID,
                )
            value = json.loads(payload)
            if not isinstance(value, dict):
                raise ValueError
            return value
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "ComfyUI returned an invalid local response",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            ) from error
        finally:
            connection.close()


class ComfyUiLocalAdapter:
    """Execute the one hardware-reviewed local SDXL workflow."""

    requires_credential = False
    descriptor = COMFYUI_LOCAL_DESCRIPTOR

    def __init__(
        self,
        api: ComfyApi,
        comfy_root: Path,
        *,
        poll_interval_seconds: float = 0.5,
        generation_timeout_seconds: float = 1_200,
    ) -> None:
        self.api = api
        self.comfy_root = comfy_root.resolve()
        self.poll_interval_seconds = poll_interval_seconds
        self.generation_timeout_seconds = generation_timeout_seconds

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        return CostEstimate(0, "USD", True, "Local installed model; no provider charge", self.descriptor.catalog_version)

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[MediaOutput]:
        self._guard(request, context)
        assert isinstance(request, ImageRequest)
        width, height = _dimensions(request)
        seed = request.seed if request.seed is not None else int.from_bytes(os.urandom(8), "big")
        graph = build_sdxl_workflow(request, seed=seed, width=width, height=height)
        client_id = uuid.uuid4().hex
        queued = self.api.json("POST", "/prompt", {"prompt": graph, "client_id": client_id})
        prompt_id = queued.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "ComfyUI did not return a prompt ID",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        record = self._wait(prompt_id)
        output = _first_output(record)
        path = _safe_output(self.comfy_root / "output", output)
        data = path.read_bytes()
        image_width, image_height = _validate_png(data)
        if (image_width, image_height) != (width, height):
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "ComfyUI output dimensions do not match the reviewed recipe",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        encoded = base64.b64encode(data).decode("ascii")
        return ProviderResult(
            COMFYUI_LOCAL_PROVIDER_ID,
            request.model,
            MediaOutput(
                (
                    MediaAsset(
                        data_base64=encoded,
                        media_type="image/png",
                        sha256=hashlib.sha256(data).hexdigest(),
                        width=width,
                        height=height,
                        license=SDXL_BUNDLE.license,
                        source_url=SDXL_BUNDLE.source_url,
                    ),
                ),
                {
                    "recipeId": SDXL_RECIPE_ID,
                    "runtimeRevision": COMFYUI_RUNTIME_REVISION,
                    "seed": seed,
                    "steps": 25,
                    "sampler": "dpmpp_2m",
                    "scheduler": "karras",
                    "cfg": 6.5,
                    "loras": [
                        {
                            "id": SDXL_OFFSET_LORA_ID,
                            "filename": SDXL_OFFSET_LORA_FILENAME,
                            "strengthModel": SDXL_OFFSET_LORA_STRENGTH,
                            "strengthClip": SDXL_OFFSET_LORA_STRENGTH,
                        }
                        for lora_id in request.loras
                        if lora_id == SDXL_OFFSET_LORA_ID
                    ],
                },
            ),
            Usage(COMFYUI_LOCAL_PROVIDER_ID, request.model, {"images": 1.0, "steps": 25.0}, 0),
            prompt_id,
        )

    def _guard(self, request: ProviderRequest, context: RequestContext) -> None:
        if context.approved_provider_id != COMFYUI_LOCAL_PROVIDER_ID:
            raise ProviderFailure(
                FailureCode.ROUTING_CONSENT_REQUIRED,
                "ComfyUI local was not approved for this request",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        if context.approved_boundary not in {None, DataBoundary.LOCAL}:
            raise ProviderFailure(FailureCode.POLICY_BLOCKED, "ComfyUI local requires a local boundary")
        if not isinstance(request, ImageRequest):
            raise ProviderFailure(FailureCode.UNSUPPORTED_CAPABILITY, "ComfyUI local supports image generation")
        if request.reference_images:
            raise ProviderFailure(FailureCode.UNSUPPORTED_CAPABILITY, "The reviewed SDXL recipe is text-to-image only")
        if len(request.loras) > 1 or any(
            lora_id != SDXL_OFFSET_LORA_ID for lora_id in request.loras
        ):
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "The reviewed SDXL recipe supports only the pinned official offset LoRA",
            )
        if request.loras and not (
            self.comfy_root / "models" / "loras" / SDXL_OFFSET_LORA_FILENAME
        ).is_file():
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "The pinned SDXL offset LoRA is not installed",
            )
        if request.model != SDXL_MODEL_ID:
            status = COMFY_BUNDLES.get(request.model)
            message = (
                f"{request.model} is downloadable but has no hardware-verified recipe"
                if status is not None
                else "Local image model is not allowlisted"
            )
            raise ProviderFailure(FailureCode.UNSUPPORTED_CAPABILITY, message)
        if not 1 <= len(request.prompt.strip()) <= 2_048:
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image prompt must contain 1 to 2048 characters")
        if request.negative_prompt is not None and len(request.negative_prompt) > 2_048:
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local negative prompt is too long")
        if request.output_format.casefold() != "png":
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "The reviewed local image output is PNG")
        if request.seed is not None and request.seed < 0:
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image seed must be non-negative")
        self.estimate(request).require_within(context.hard_budget_micros)

    def _wait(self, prompt_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.generation_timeout_seconds
        while time.monotonic() < deadline:
            history = self.api.json("GET", f"/history/{prompt_id}")
            record = history.get(prompt_id)
            if isinstance(record, dict):
                status = record.get("status")
                if isinstance(status, dict) and status.get("status_str") == "error":
                    raise ProviderFailure(
                        FailureCode.PROVIDER_ERROR,
                        "ComfyUI reported a generation failure",
                        provider_id=COMFYUI_LOCAL_PROVIDER_ID,
                    )
                if record.get("outputs"):
                    return record
            time.sleep(self.poll_interval_seconds)
        raise ProviderFailure(
            FailureCode.TIMEOUT,
            "ComfyUI generation timed out",
            provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            retryable=True,
        )


class ComfyUiRuntime(AbstractContextManager[ComfyUiLocalAdapter]):
    """Supervise one hidden loopback runtime and release the shared GPU lock."""

    def __init__(
        self,
        runtime_root: Path,
        *,
        port: int = 8192,
        gpu_lock: Path | None = None,
    ) -> None:
        if not 1_024 <= port <= 65_535:
            raise ValueError("ComfyUI port is outside the allowed range")
        self.installer = ComfyBundleInstaller(runtime_root)
        self.port = port
        self.gpu_lock = gpu_lock
        self.process: subprocess.Popen[bytes] | None = None
        self.log_handle: Any = None
        self._gpu_guard: GpuExecutionGuard | None = None

    def __enter__(self) -> ComfyUiLocalAdapter:
        preflight = self.installer.preflight(SDXL_MODEL_ID)
        if not preflight["executable"]:
            raise RuntimeError("The verified SDXL local image bundle is not installed")
        guard = GpuExecutionGuard(self.gpu_lock, owner="comfyui-local")
        guard.__enter__()
        self._gpu_guard = guard
        try:
            environment = os.environ.copy()
            cache = self.installer.runtime_root / "cache"
            temporary = self.installer.runtime_root / "tmp"
            cache.mkdir(parents=True, exist_ok=True)
            temporary.mkdir(parents=True, exist_ok=True)
            environment.update(
                {
                    "HF_HOME": str(cache / "huggingface"),
                    "HUGGINGFACE_HUB_CACHE": str(cache / "huggingface" / "hub"),
                    "PIP_CACHE_DIR": str(cache / "pip"),
                    "TEMP": str(temporary),
                    "TMP": str(temporary),
                    "PYTHONNOUSERSITE": "1",
                }
            )
            logs = self.installer.runtime_root / "logs"
            logs.mkdir(parents=True, exist_ok=True)
            self.log_handle = (logs / "comfyui-local.log").open("ab")
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self.process = subprocess.Popen(
                (
                    str(self.installer.python_executable),
                    "main.py",
                    "--listen",
                    "127.0.0.1",
                    "--port",
                    str(self.port),
                    "--disable-auto-launch",
                    "--disable-api-nodes",
                    "--lowvram",
                ),
                cwd=self.installer.comfy_root,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=self.log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
                shell=False,
            )
            api = ComfyApi(f"http://127.0.0.1:{self.port}")
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("ComfyUI exited before its API became ready")
                try:
                    api.json("GET", "/system_stats")
                    return ComfyUiLocalAdapter(api, self.installer.comfy_root)
                except ProviderFailure:
                    time.sleep(1)
            raise TimeoutError("ComfyUI did not become ready")
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        try:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=20)
        finally:
            try:
                if self.log_handle is not None:
                    self.log_handle.close()
                    self.log_handle = None
            finally:
                guard = self._gpu_guard
                self._gpu_guard = None
                if guard is not None:
                    if self.process is not None and self.process.poll() is None:
                        guard.preserve_claim()
                    guard.__exit__(exc_type, exc, traceback)
        return None


class ComfyGenerationMediaClient:
    """Replace only local image generation while preserving other media lanes."""

    provider_id = "local-runtime"

    def __init__(
        self,
        fallback: GenerationMediaClient,
        runtime_root: Path,
        *,
        gpu_lock: Path,
        port: int = 8192,
    ) -> None:
        self.fallback = fallback
        self.runtime_root = runtime_root.resolve()
        self.gpu_lock = gpu_lock
        self.port = port
        self.model_revision = (
            f"{SDXL_MODEL_ID}@{COMFYUI_RUNTIME_REVISION}+{fallback.model_revision}"
        )

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        from alystria.generation.adapters import GeneratedMedia

        recipe = _image_recipe(scene)
        model = recipe.get("model", SDXL_MODEL_ID)
        if model != SDXL_MODEL_ID:
            raise ValueError(f"Local ComfyUI image recipe must use {SDXL_MODEL_ID}")
        raw_loras = recipe.get("loras", ())
        if not isinstance(raw_loras, (list, tuple)) or any(
            not isinstance(item, str) for item in raw_loras
        ):
            raise ValueError("Local ComfyUI image recipe loras must be an array of IDs")
        loras = tuple(raw_loras)
        role = scene.get("imageRole", "scene")
        if role not in {"scene", "presenter"}:
            raise ValueError("Local ComfyUI image role must be scene or presenter")
        negative_prompt = recipe.get("negativePrompt")
        if negative_prompt is not None and not isinstance(negative_prompt, str):
            raise ValueError("Local ComfyUI negative prompt must be text")
        prompt = str(scene.get("visualIntent") or scene.get("title") or "").strip()
        request = ImageRequest(
            prompt,
            SDXL_MODEL_ID,
            aspect_ratio="1:1" if role == "presenter" else "16:9",
            negative_prompt=negative_prompt,
            seed=seed,
            loras=loras,
        )
        context = RequestContext(
            idempotency_key=hashlib.sha256(
                json.dumps(
                    {
                        "sceneId": str(scene.get("id", "")),
                        "seed": seed,
                        "model": model,
                        "loras": loras,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest(),
            approved_provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            approved_boundary=DataBoundary.LOCAL,
            approved_retention=RetentionMode.LOCAL_ONLY,
        )
        with ComfyUiRuntime(
            self.runtime_root,
            port=self.port,
            gpu_lock=self.gpu_lock,
        ) as adapter:
            result = adapter.invoke(request, context)
        if len(result.value.assets) != 1:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Local ComfyUI returned an unexpected image count",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        asset = result.value.assets[0]
        if asset.data_base64 is None:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Local ComfyUI did not return inline image bytes",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        if asset.media_type != "image/png":
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Local ComfyUI returned an unexpected image type",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            )
        try:
            content = base64.b64decode(asset.data_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Local ComfyUI returned invalid inline image bytes",
                provider_id=COMFYUI_LOCAL_PROVIDER_ID,
            ) from error
        metadata = {
            **result.value.metadata,
            "recipeId": SDXL_RECIPE_ID if role == "presenter" else SDXL_SCENE_RECIPE_ID,
            "origin": "local-generated",
            "rightsStatus": "verified",
            "licenseId": SDXL_BUNDLE.license,
            "sourceUri": SDXL_BUNDLE.source_url,
            "attribution": "Generated locally with Stability AI SDXL 1.0",
            "width": asset.width,
            "height": asset.height,
        }
        return GeneratedMedia(
            content,
            asset.media_type,
            f"{scene.get('id', 'local-image')!s}.png",
            COMFYUI_LOCAL_PROVIDER_ID,
            f"{result.model}@{COMFYUI_RUNTIME_REVISION}",
            metadata,
            result.usage.actual_cost_micros,
            result.usage.units,
        )

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        return self.fallback.synthesize_narration(scene, locale=locale, seed=seed)

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None:
        return self.fallback.create_presenter(
            scene,
            narration_hash=narration_hash,
            seed=seed,
        )

    def cancel(self) -> None:
        cancel = getattr(self.fallback, "cancel", None)
        if callable(cancel):
            cancel()


def _image_recipe(scene: dict[str, Any]) -> dict[str, Any]:
    value = scene.get("imageRecipe")
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Local ComfyUI image recipe must be an object")
    unsupported = set(value) - {"model", "loras", "negativePrompt"}
    if unsupported:
        raise ValueError(
            "Local ComfyUI image recipe has unsupported controls: "
            + ", ".join(sorted(str(item) for item in unsupported))
        )
    return value


def build_sdxl_workflow(
    request: ImageRequest,
    *,
    seed: int,
    width: int,
    height: int,
) -> dict[str, Any]:
    negative = request.negative_prompt or (
        "text, watermark, logo, duplicate, deformed anatomy, cropped face, low resolution"
    )
    model_source = ["8", 0] if request.loras else ["1", 0]
    clip_source = ["8", 1] if request.loras else ["1", 1]
    workflow: dict[str, Any] = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"},
        },
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": request.prompt.strip(), "clip": clip_source}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": clip_source}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": 25,
                "cfg": 6.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
                "model": model_source,
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
            },
        },
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "alystria/local-sdxl", "images": ["6", 0]},
        },
    }
    if request.loras:
        workflow["8"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": SDXL_OFFSET_LORA_FILENAME,
                "strength_model": SDXL_OFFSET_LORA_STRENGTH,
                "strength_clip": SDXL_OFFSET_LORA_STRENGTH,
            },
        }
    return workflow


def _dimensions(request: ImageRequest) -> tuple[int, int]:
    if request.size:
        match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", request.size)
        if match is None:
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image size is invalid")
        width, height = int(match.group(1)), int(match.group(2))
    else:
        selected = {
            "1:1": (1024, 1024),
            "16:9": (1344, 768),
            "9:16": (768, 1344),
            "4:3": (1152, 896),
            "3:4": (896, 1152),
        }.get(request.aspect_ratio)
        if selected is None:
            raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image aspect ratio is unsupported")
        width, height = selected
    if width % 64 or height % 64 or not 512 <= width <= 1536 or not 512 <= height <= 1536:
        raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image dimensions must be 512-1536 and divisible by 64")
    if width * height > 1_100_000:
        raise ProviderFailure(FailureCode.INVALID_REQUEST, "Local image request exceeds the reviewed pixel budget")
    return width, height


def _download_verified(
    item: DownloadFile,
    root: Path,
    progress: Callable[[str, int, int], None],
) -> Path:
    destination = _safe_destination(root, item.relative_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size == item.size and _sha256(destination) == item.sha256:
        progress(destination.name, item.size, item.size)
        return destination
    partial = destination.with_suffix(destination.suffix + ".part")
    partial.unlink(missing_ok=True)
    request = urllib.request.Request(item.url, headers={"User-Agent": "Alystria/1 local-model-installer"})
    written = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
            final = urlsplit(response.geturl())
            if final.scheme != "https" or final.hostname is None:
                raise RuntimeError("Model download redirected outside HTTPS")
            while block := response.read(1024 * 1024):
                written += len(block)
                if written > item.size:
                    raise RuntimeError("Model download exceeded its pinned size")
                output.write(block)
                digest.update(block)
                progress(destination.name, written, item.size)
        if written != item.size or digest.hexdigest() != item.sha256:
            raise RuntimeError("Model download failed content verification")
        os.replace(partial, destination)
        return destination
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def _safe_destination(root: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts or any(":" in part for part in relative.parts):
        raise ValueError("Model destination escapes the runtime root")
    destination = (root / relative).resolve()
    if destination != root.resolve() and root.resolve() not in destination.parents:
        raise ValueError("Model destination escapes the runtime root")
    return destination


def _safe_output(output_root: Path, item: dict[str, Any]) -> Path:
    filename = item.get("filename")
    subfolder = item.get("subfolder", "")
    if not isinstance(filename, str) or _MODEL_FILE.fullmatch(filename) is None:
        raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI output filename is unsafe")
    if not isinstance(subfolder, str):
        raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI output folder is unsafe")
    path = _safe_destination(output_root.resolve(), str(Path(subfolder) / filename))
    if not path.is_file() or not 16 <= path.stat().st_size <= 100_000_000:
        raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI output file is missing or invalid")
    return path


def _first_output(record: dict[str, Any]) -> dict[str, Any]:
    outputs = record.get("outputs")
    if isinstance(outputs, dict):
        for output in outputs.values():
            images = output.get("images") if isinstance(output, dict) else None
            if isinstance(images, list) and images and isinstance(images[0], dict):
                return images[0]
    raise ProviderFailure(
        FailureCode.MALFORMED_RESPONSE,
        "ComfyUI completed without a saved image",
        provider_id=COMFYUI_LOCAL_PROVIDER_ID,
    )


def _validate_png(data: bytes) -> tuple[int, int]:
    if not data.startswith(_PNG_MAGIC) or len(data) < 24 or data[12:16] != b"IHDR":
        raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI output is not a PNG")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if not width or not height:
        raise ProviderFailure(FailureCode.MALFORMED_RESPONSE, "ComfyUI PNG dimensions are invalid")
    return width, height


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(8 * 1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _safe_manifest_name(model_id: str) -> str:
    return re.sub(r"[^a-z0-9.-]+", "-", model_id.casefold()).strip("-")
