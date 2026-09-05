# Local image model audit for the 12 GB Windows target

**Audit date:** 2026-09-05
**Target:** Windows 11, NVIDIA GeForce RTX 4080 Laptop GPU, 12,282 MiB VRAM,
32 GB system RAM
**Runtime root:** `E:\temp\Alystria Local Image Lab`
**Status vocabulary:** *hardware-verified* means a real image completed through
the pinned local ComfyUI API on this machine. *Candidate* means the files,
license, loader support, and memory strategy were checked, but the exact recipe
has not completed here.

## Decision

Use **SDXL 1.0 base** as the hardware-verified initial local
portrait-generation download for the
12 GB tier. It is a single 6.94 GB checkpoint, has mature native ComfyUI support,
and its official Hugging Face model tree currently links 9,694 adapters. The
base license is CreativeML Open RAIL++-M. Every third-party LoRA still needs its
own license and an explicit `SDXL 1.0` base-model declaration; the base license
must never be inferred onto an adapter.

Offer **FLUX.2 Klein 4B FP8** and **Z-Image-Turbo INT8** as advanced downloads
with CPU offload. Their quantized weight sets are small enough to make a 12 GB
attempt reasonable, and current ComfyUI supports both families. They remain
*candidates* until each exact recipe completes on this laptop. Black Forest Labs
quotes about 13 GB even for Klein 4B, while Tongyi states that Z-Image-Turbo fits
within 16 GB. Calling either one “12 GB verified” from file size alone would be
misleading.

Do not offer the Z-Image BF16 checkpoint on the 12 GB tier. Its diffusion file
alone is 12.31 GB before the 8.04 GB text encoder, VAE, activations, and runtime
overhead.

## Exact downloadable recipes

### SDXL 1.0 base — local default

- Repository: `stabilityai/stable-diffusion-xl-base-1.0`
- Revision: `462165984030d82259a11f4367a4eed129e94a7b`
- License: CreativeML Open RAIL++-M (`openrail++`)
- Checkpoint: `sd_xl_base_1.0.safetensors`
  - 6,938,078,334 bytes
  - SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b`
  - destination `ComfyUI/models/checkpoints/`
- Official optional adapter: `sd_xl_offset_example-lora_1.0.safetensors`
  - 49,553,604 bytes
  - SHA-256 `4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f`
  - destination `ComfyUI/models/loras/`
  - this is a small official offset demonstration, not a general portrait-style
    pack
- Starting recipe: 1024×1024, 24–30 steps, DPM++ 2M Karras, CFG 6–7. The
  official ComfyUI SDXL examples also recommend approximately one megapixel,
  including 896×1152 and 1536×640.

### FLUX.2 Klein 4B FP8 — advanced candidate

Diffusion model:

- Repository: `black-forest-labs/FLUX.2-klein-4b-fp8`
- Revision: `5b4408e59397a4a37ccb46afe426d8ed86379441`
- License: Apache-2.0
- File: `flux-2-klein-4b-fp8.safetensors`
  - 4,070,624,520 bytes
  - SHA-256 `97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6`
  - destination `ComfyUI/models/diffusion_models/`

ComfyUI encoder and VAE pack:

- Repository: `Comfy-Org/vae-text-encorder-for-flux-klein-4b`
- Revision: `5f526678002e43af5551dadb73ce2e8c91b43afe`
- License: Apache-2.0
- `split_files/text_encoders/qwen_3_4b_fp4_flux2.safetensors`
  - 3,848,213,998 bytes
  - SHA-256 `3eab03a77adb0ee5304a4e677d5c10ac22f9049c1d7c894adca4f8bb39206ca8`
  - destination name `qwen_3_4b_fp4_flux2.safetensors` in
    `ComfyUI/models/text_encoders/`
- `split_files/vae/flux2-vae.safetensors`
  - 336,211,292 bytes
  - SHA-256 `868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3`
  - destination `ComfyUI/models/vae/`

The three files total 8,255,049,810 bytes (7.69 GiB) on disk. Disk size is not
peak VRAM. Start in `--lowvram` mode and retain CPU offload; the publisher's own
FP8 card still gives an approximately 13 GB figure. Klein is distilled for four
steps and CFG/guidance 1, and it adds multi-reference editing that SDXL does not
provide natively.

### Z-Image-Turbo INT8 — advanced candidate

- Original repository: `Tongyi-MAI/Z-Image-Turbo`
- Original revision inspected: `f332072aa78be7aecdf3ee76d5c247082da564a6`
- ComfyUI pack: `Comfy-Org/z_image_turbo`
- ComfyUI pack revision: `08d04455279082882deaabc8d0d09fc914c071e1`
- License: Apache-2.0
- `split_files/diffusion_models/z_image_turbo_int8_convrot.safetensors`
  - 6,201,001,296 bytes
  - SHA-256 `be517ebd47c912a5626a588e1aeea43e6be4a43c0cdcd2b48a2a780d9f358635`
  - destination name `z_image_turbo_int8_convrot.safetensors` in
    `ComfyUI/models/diffusion_models/`
- `split_files/text_encoders/qwen_3_4b_fp4_mixed.safetensors`
  - 3,479,416,193 bytes
  - SHA-256 `7ca32dcf07dfe7692945d80fff86e3a74cb83c6206b9b223ac6836b939bb85d6`
  - destination name `qwen_3_4b_fp4_mixed.safetensors` in
    `ComfyUI/models/text_encoders/`
- `split_files/vae/ae.safetensors`
  - 335,304,388 bytes
  - SHA-256 `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38`
  - destination `ComfyUI/models/vae/`

The three files total 10,015,721,877 bytes (9.33 GiB). Start in `--lowvram`
mode. Use eight effective model evaluations, guidance/CFG 0, and 1024×1024.
The official model highlights photorealism, English/Chinese text, and
instruction following, but the distilled Turbo model explicitly trades away
output diversity and fine-tunability.

The pack also publishes NVFP4 weights. Those are smaller, but the model format
depends on a supported NVIDIA/backend path. INT8 ConvRot is the safer generic
NVIDIA catalog choice until NVFP4 is separately tested on the shipping runtime.

## Runtime pin and isolation

The isolated image lab is installed under `E:\temp`; no model weight, Python
environment, Hugging Face cache, pip cache, output, or temporary generation data
belongs on the constrained `C:` drive.

- Runtime: `Comfy-Org/ComfyUI`
- Stable tag: `v0.9.2`
- Commit: `8f40b43e0204d5b9780f3e9618e140e929e80594`
- Python: 3.12.2, isolated virtual environment under the image-lab root
- PyTorch: Windows CUDA 13.0 build, following the current ComfyUI NVIDIA manual
  install recommendation
- API: loopback only, `127.0.0.1`, with API nodes disabled and browser launch
  disabled

ComfyUI officially supports Windows, NVIDIA GPUs, quantized models, smart VRAM
management, model offload, saved JSON workflows, and a local API. The stable
v0.9.2 release specifically includes FLUX.2 Klein support; Z-Image support and
examples predate it.

## Hardware proof

This section records completed local API generation, not a model load, metadata
parse, or an older screenshot.

- Recipe: `comfy-sdxl-1.0-portrait-v1`
- Runtime: ComfyUI 0.9.2 at
  `8f40b43e0204d5b9780f3e9618e140e929e80594`
- Python/PyTorch: 3.12.2 / 2.14.0+cu130
- Launch conditions: loopback port 8192, `--lowvram`,
  `--disable-api-nodes`, no browser launch
- Fixed recipe: seed 20260905, 1024×1024, 25 steps, DPM++ 2M Karras,
  CFG 6.5
- Base result: 86.234 seconds cold
  - `E:\temp\Alystria Local Image Lab\evidence\sdxl-base.png`
  - 1,231,684 bytes
  - SHA-256 `320f60bb3ea8623fbfd27852bf4c2578e19c40d55cac6f0ec0902f419e18f8a4`
- Official offset-LoRA result at strength 0.35: 29.984 seconds warm
  - `E:\temp\Alystria Local Image Lab\evidence\sdxl-offset-lora.png`
  - 1,155,398 bytes
  - SHA-256 `bbda233b4d1fc1df069bf73d65ed1b910187404a0775962d0b6bf50905ab944`
- Machine-readable manifest:
  `E:\temp\Alystria Local Image Lab\evidence\sdxl-smoke-manifest.json`
  - SHA-256 `a471db5d44779a92acd23042bfbe7e2ef4ed9b83f242a97ed79ccfcf3e7ee420`
- Observed GPU-memory spot checks during active generation were 5,951 MiB and
  8,519 MiB. WDDM did not expose a reliable per-process peak, so these are
  observations rather than a peak-memory claim.
- Both outputs were opened at original resolution. Both are centered,
  front-facing South Asian presenter portraits with visible chin, closed mouth,
  stable eyes, and clean background. The base result is more natural. The
  offset-LoRA result has a minor hand/watch artifact outside the intended
  head-and-shoulders crop, so the LoRA is tested and optional rather than the
  recommended default.

The shared GPU lock was `yes` only from immediately before ComfyUI loaded CUDA
through completion of both jobs. It was restored to `no` after the process
terminated. SDXL is therefore hardware-verified for this machine; FLUX.2 Klein
and Z-Image remain candidates.

## Integrated local route

The shipping-side implementation is bounded to the hardware-reviewed path:

- `services/pipeline/src/alystria/providers/comfyui_local.py` pins the ComfyUI
  portable archive and every model artifact by URL, revision, byte size and
  SHA-256. Downloads are written to a sibling `.part` file, verified, and then
  atomically moved into the live model directory. Failed partials are removed.
- `ComfyBundleInstaller` installs or preflights the exact bundle. The headless
  CLI bridge is `alystria-pipeline local-image install|preflight
  --runtime-root <absolute-path> --model-id <id>` and emits one bounded JSON
  result for the native download manager.
- `ComfyUiRuntime` starts ComfyUI without a visible window, binds only to
  loopback, relocates caches and temporary files beneath the selected runtime
  root, claims the shared GPU lease immediately before startup, and releases it
  on normal exit, launch failure, readiness failure, or provider exceptions.
- `ComfyGenerationMediaClient` replaces only image generation. Narration and
  presenter animation remain delegated to the selected media client.
- The exact supported request is SDXL 1.0 with the caller's deterministic seed
  and an optional single LoRA ID `local/sdxl-offset-lora-1.0`. That LoRA always
  uses the measured model/CLIP strength `0.35`. Arbitrary LoRA paths, weights,
  models, graph nodes and recipe keys are rejected.
- Presenter requests use 1024×1024; scene-art requests use 1344×768. The result
  is returned as validated PNG bytes with model, runtime, recipe, seed, LoRA,
  rights and license provenance.
- The desktop generation panel defaults to the tutorial's configured image
  route, so connected providers remain available without a local install. Its
  local option is the exact SDXL route above; the LoRA toggle is disabled for
  every other route. Designed-layout mode does not show an image-generation
  action.

The existing E: installation passed the CLI preflight after hashing the full
checkpoint and optional LoRA: `runtimeReady: true`, `executable: true`, and
both files `verified: true`.

The real candidate lifecycle was then exercised through
`ComfyGenerationMediaClient`, `NativeControlCoordinator`, the project CAS,
explicit candidate acceptance, and the production asset resolver:

- Evidence manifest:
  `E:\temp\Alystria Local Image Lab\evidence\production-candidate-20260905-113404\production-candidate-proof.json`
- Accepted PNG:
  `E:\temp\Alystria Local Image Lab\evidence\production-candidate-20260905-113404\accepted-scene-candidate.png`
- PNG SHA-256:
  `aec71cf6fdd08e1016bd5751b2f83546d299d69ec2d7f5874683e65b698ae943`
- Output: 1344×768, 1,122,549 bytes; 141.987 seconds from a cold runtime.
- Observed total device-memory samples rose from 420 MiB to 8,473 MiB. These
  WDDM device totals are not a process-specific or guaranteed peak claim.
- The queued regeneration job completed, produced a review candidate, left the
  active scene untouched, and was accepted explicitly. Candidate, accepted
  scene, and resolved asset hashes matched exactly.

Visual inspection found a polished editorial office scene, but it did not
communicate binary search and contained pseudo-text. The proof instruction also
asked for numbered cards while the safety suffix prohibited numbers. The
review-before-use boundary behaved correctly and prevented automatic promotion;
the content miss demonstrates why prompts must avoid contradictory constraints
and why generated candidates still need semantic review.

The proof exposed a provenance label that used the portrait recipe ID for a
scene result. `ComfyGenerationMediaClient` now emits
`comfy-sdxl-1.0-scene-v1` for scene art and retains
`comfy-sdxl-1.0-portrait-v1` for presenter portraits, with a focused regression.
The historical proof manifest intentionally retains the original label as
evidence of the defect that was found.

## Product rules

1. Show model download size, expected total disk footprint, license name, exact
   revision, and verification status before installation.
2. Verify every downloaded file against its SHA-256 before moving it into the
   live model directory. Use a sibling `.part` file and remove it on a failed
   or interrupted verification.
3. Never describe a LoRA as compatible because it is merely a `.safetensors`
   file. Require a declared base family and version, supported loader type,
   trigger words where applicable, and an independent license record.
4. Preserve the selected checkpoint, LoRA list and fixed strength, full positive and
   negative prompts, dimensions, sampler, scheduler, steps, CFG, and seed with
   each accepted portrait.
5. Keep the UI status distinct: `available to download`, `installed`,
   `hardware-verified`, `failed verification`, and `unsupported on this tier`.
6. Portrait generation must run through a real connected route. Saving a recipe
   is useful project state, but it is not a queued or completed generation.

## Primary sources opened on 2026-09-05

- [Black Forest Labs FLUX.2 Klein 4B model](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- [Black Forest Labs FLUX.2 Klein 4B FP8 model](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8)
- [Black Forest Labs FLUX.2 source](https://github.com/black-forest-labs/flux2)
- [Comfy-Org Klein 4B encoder/VAE pack](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b)
- [Tongyi-MAI Z-Image-Turbo model](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
- [Tongyi-MAI Z-Image source](https://github.com/Tongyi-MAI/Z-Image)
- [Comfy-Org Z-Image-Turbo pack](https://huggingface.co/Comfy-Org/z_image_turbo)
- [ComfyUI Z-Image example](https://comfyanonymous.github.io/ComfyUI_examples/z_image/)
- [Stability AI SDXL 1.0 base model](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)
- [Stability AI generative-models source](https://github.com/Stability-AI/generative-models)
- [ComfyUI SDXL example](https://comfyanonymous.github.io/ComfyUI_examples/sdxl/)
- [ComfyUI source and Windows install guide](https://github.com/Comfy-Org/ComfyUI)
- [ComfyUI v0.9.2 release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.9.2)
- [ComfyUI example-workflow source](https://github.com/comfyanonymous/ComfyUI_examples)
