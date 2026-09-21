# Local model profiles for the 12 GB RTX 4080 Laptop target

Research candidates were first surveyed on **2026-08-28**. The executable RC
surface below was reconciled with the native catalog on **2026-09-21**. Model
weights are not bundled in the installer; only packages with an immutable
native declaration can be downloaded.

The workload-specific native-Windows runtime decision, current RTX 4080 laptop
probe, LM Studio CUDA 12 verdict, and confirmed NVENC API mismatch are recorded
in [Windows + NVIDIA runtime audit](windows-nvidia-runtime-audit.md).

## Recommendation in one sentence

Ship a small Alystria installer, then let the first-run setup and **Models &
Providers** share one native download queue. The current catalog offers the
standalone ComfyUI runtime, executable SDXL and SoulX packs, advanced
download-only FLUX.2 Klein and Z-Image packs, and quarantine-only MuseTalk.
Cloud routes and authored slides remain usable without local weights.
Downloaded weights belong in the managed app-data model cache, not the project
repository or installer.

Bundling weights would make the installer multi-gigabyte, couple every user to
one GPU/runtime/license combination, and make updates and revocations unsafe.
The native model manager uses embedded, hash-pinned declarations, license
acceptance, resumable `.part` downloads, exact byte/hash verification, isolated
staging, and full-ledger revalidation before executable activation. These
manifests are integrity-pinned but are not represented as cryptographically
signed metadata.

## Candidate matrix

The fit column is a conservative planning judgment from parameter size,
published runtime guidance, and the 12 GB target. It is not a measured
tokens-per-second or frames-per-second result. The release manager must replace
`pin-required` with an immutable revision, artifact list, SHA-256 values,
license hash, and target fixture benchmark before activation.

| Workload | Recommended candidate | Evidence and license | 12 GB disposition |
|---|---|---|---|
| Main local LLM/VLM | [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B), GGUF Q4-class profile through llama.cpp | 9B multimodal model, Apache-2.0; official card documents Transformers/vLLM/SGLang/local-app paths and a 262k native context | **Best quality/coverage candidate; pin and benchmark.** Keep context bounded (start at 8k–16k) so KV cache and compositor workers retain headroom. |
| Fast LLM/VLM fallback | [Gemma 3 4B IT](https://huggingface.co/google/gemma-3-4b-it) | 4B BF16 multimodal checkpoint; Google Gemma terms apply; official card documents local vLLM use | **Likely comfortable.** Good fallback when Qwen3.5 is busy or memory pressure is high; license acceptance is mandatory. |
| Small instruction/code fallback | [Phi-4-mini-instruct](https://huggingface.co/microsoft/Phi-4-mini-instruct) | 4B BF16 checkpoint, MIT; official card documents vLLM/local Docker paths and constrained-environment usage | **Comfortable after quantization/ONNX pin.** Strong compact option for script review and code explanations. |
| Code-specialist option | [Qwen2.5-Coder-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct) | Official card documents local Transformers/vLLM use; review the exact model license/revision before activation | **Candidate, not default.** Load instead of the main LLM, never beside another GPU-heavy family. |
| Embeddings | [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) | Apache-2.0; 100+ languages, 32k context, up to 1024 dimensions, instruction-aware query/document use | **Recommended default retrieval model.** Small enough to remain warm or run through ONNX/TEI. |
| Multilingual retrieval fallback | [BGE-M3](https://huggingface.co/BAAI/bge-m3) | Dense, sparse, and multi-vector retrieval; 100+ languages and up to 8192-token inputs | **Comfortable candidate.** Keep as an alternative to Qwen3 embeddings after license/hash review. |
| Reranking | [BGE-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) or the Qwen3 0.6B reranker family | Official cards describe pairwise relevance scoring; Qwen3's embedding project lists 0.6B/4B/8B rerankers | **Recommended local reranker.** Prefer the smallest audited model; NVIDIA hosted reranking stays dormant. |
| Production-quality local TTS | [Qwen3-TTS 0.6B CustomVoice/Base](https://github.com/QwenLM/Qwen3-TTS) | Apache-licensed project; 0.6B and 1.7B families, voice design/clone/custom voices, streaming; 10 documented languages including English and Spanish but not Hindi | **Candidate for EN/ES.** Hindi needs a separate locale profile or approved cloud voice; consent is mandatory for cloning. |
| Draft/CPU TTS | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) with [ONNX](https://huggingface.co/onnx-community/Kokoro-82M-ONNX) | Apache-2.0, 82M parameters, voices and q8/q4 ONNX options | **Recommended always-available draft voice.** Verify the selected voice/language pack; do not assume Hindi coverage from the base card. |
| Legacy TTS fallback | [Piper](https://github.com/rhasspy/piper) / successor project | Fast local neural TTS, but the original repository is archived and development moved; every voice pack needs its own license review | **Optional only.** Do not make archived Piper weights the default without a maintained, license-cleared pack. |
| ASR/transcription | [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) through [faster-whisper](https://github.com/SYSTRAN/faster-whisper) or [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Turbo prunes the decoder from 32 to 4 layers for much faster inference with a minor quality trade-off; faster-whisper documents lower memory/8-bit paths; whisper.cpp supports Windows, NVIDIA, Vulkan, quantization, and CPU | **Recommended local ASR.** Use a quantized/runtime-specific artifact and keep WhisperX/MFA as separate alignment stages. |
| Presenter lip-sync specialist | [MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk) | Official project reports 30fps+ on a Tesla V100, 256×256 face-region processing, and multilingual audio examples | **Fast face-only candidate; benchmark required.** Use fp16, batch 1–2, short chunks, and one GPU-heavy family at a time. |
| Expressive talking head / upper body | [EchoMimicV3 Flash](https://github.com/antgroup/echomimic_v3) | Official repo reports 1.3B parameters, 12G VRAM for Flash, 8-step high-quality generation, up to 768×768, Apache-2.0, and a quantified Windows package | **First benchmark target for this laptop.** Use five talking-head steps, partial clips (81/65 frames or shorter), and keep the 12 GB VRAM headroom gate strict. |
| Diffusion lip-sync alternative | [LatentSync 1.5](https://github.com/bytedance/LatentSync) | Official README states 8 GB minimum VRAM for 1.5 and 18 GB for 1.6; 1.5 improves temporal consistency over earlier versions | **1.5 is a viable slower candidate; 1.6 is not a 12 GB target.** Chunk long clips and test seam behavior. |
| Pose/expression animation | [LivePortrait](https://github.com/KwaiVGI/LivePortrait) | Official implementation supports portrait animation, pose/expression/lip regions, and Windows setup | **Complement, not audio LipSync.** It does not replace an audio-conditioned lip-sync model. |
| Fast/older baseline | [Wav2Lip](https://github.com/Rudrabha/Wav2Lip) | Mature speech-to-lip baseline; model/checkpoint licensing and commercial restrictions need separate review | **Fallback benchmark only.** Do not ship it as the default without rights review. |
| Image illustration | [FLUX.2 Klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) | Current model card describes a compact image/editing model; license and model-card terms must be preserved | **Optional, one-family-at-a-time.** It can compete with the LLM for 12 GB; benchmark with offload before enabling. |
| Fast draft image | [SDXL-Turbo](https://huggingface.co/stabilityai/sdxl-turbo) | 3B model, 1–4-step generation, 512×512 preferred; the model card carries Stability's noncommercial/community license boundary | **Preview-only candidate until rights are accepted.** Do not use it for export-cleared assets by default. |
| NVIDIA local LipSync | [NVIDIA LipSync](https://build.nvidia.com/nvidia/lipsync/modelcard) | Downloadable NIM; AI for Media Private Access, NGC key, NVIDIA container stack, and NVIDIA Open Model License | **Separate gated candidate.** Not unlocked by the ordinary NIM hosted key; target RTX 4080 Laptop verification is still open. |

## Current presenter-animation decision

The executable local default is **SoulX-FlashHead Pro** at exact revision
`soulx-9bc03de0+pro-59119b6c+wav2vec-22aad52d+py3106+cu128`. Eight exact bundled
portraits passed the current short-sample mouth, blink, identity, and background
review. Other bundled portraits remain still-only until their exact route passes
the same review. A custom fictional/generated portrait must be added to a cast,
rendered with the managed short preview, played by the user, and explicitly
accepted before animated generation is allowed for its portrait hash and model
revision.

MuseTalk remains a quarantine-only download and is not activated by the model
manager. EchoMimicV3 exceeded the reference machine's practical memory budget
before producing a first frame, so it is not the default or an executable RC
choice. LatentSync and NVIDIA LipSync remain research candidates rather than
silent fallbacks.

NVIDIA LipSync is technically interesting for this laptop: its model card lists
Lovelace/Ada compatibility and Windows 10/11, and it requires NVENC/NVDEC. The
current support matrix optimizes consumer RTX 4090/5090/5080 profiles but does
not name the RTX 4080 Laptop. The published container path requires NVIDIA
driver 571.21+, Docker, NVIDIA Container Toolkit, CUDA 12.8.1, cuDNN 9.7.1.26,
TensorRT 10.9.0.34, Triton 2.56, and DeepStream 8.0; it normally exposes gRPC
on port 8001. We have not installed or benchmarked that stack.

## First-run setup assistant

The installer should contain the shell, signed sidecars, fonts, and model
catalog—not model weights. On first launch:

1. Probe OS, GPU architecture, currently free VRAM, RAM, disk, CUDA/Vulkan/
   NVENC capability, and whether another GPU-heavy job is active.
2. Offer **Recommended for this computer**, **Choose an existing model folder**,
   **Download a different profile**, or **Skip and use cloud/local mock**.
3. Show each model's purpose, exact revision, download size, disk destination,
   VRAM/RAM estimate, supported locales, license/attribution, privacy boundary,
   and whether it is benchmark-verified on this machine.
4. For an existing folder, validate magic/type, expected files, revision and
   hashes where known, license metadata, runtime compatibility, and symlink/path
   safety. Store a project-independent model identity, not executable code or a
   fragile absolute path.
5. For managed downloads, stage resumable `.part` files, verify every declared
   byte count and SHA-256 hash, require license acceptance, atomically promote
   the complete pack, and retain rollback history. A failed or interrupted
   download never becomes active. These are embedded, hash-pinned declarations;
   the current manifests are not cryptographically signed.
6. Schedule one GPU-heavy family at a time. If a selected model does not fit,
   explain the exact reason and offer a smaller approved profile; never silently
   move project content to a cloud provider.

The assistant can be reopened from **Models & Providers → Local models**. The
profile examples above are research candidates, not a promise of an installer
for every listed model. Only the declared packages listed below can currently
be downloaded through this surface.

### Current RC setup surface

Selecting an available model in onboarding immediately queues it in the native
manager, closes setup, and opens the app-wide Downloads panel. The panel can
minimize while navigation and other work continue. Model Library uses the same
persisted queue. Entries show actual transferred bytes, linked licenses,
retry/resume, and installed reuse. Downloading accepts the displayed license;
there is no additional checkbox. Fresh setup selects no optional packs.
Unstarted requests can be removed. Active transfers continue while the app is
open; an interrupted transfer can resume from retained partial files.

Available packages and existing installations appear first. Entries without a
verified installer are disabled in onboarding rather than saving a choice that
cannot download. The native catalog currently declares six packages:

- `runtime/comfyui-0.9.2`, the reusable standalone ComfyUI runtime;
- `local/sdxl-base-1.0`, an executable, reviewed image-generation pack;
- `local/flux.2-klein-4b-fp8` and `local/z-image-turbo-int8`, advanced
  download-only image packs whose inference routes remain unavailable;
- `local/musetalk-1.5`, a downloaded, verified, quarantine-only pack which
  cannot be activated; and
- `local/soulx-flashhead-pro`, an executable presenter pack whose download is
  staged until **Use model** completes full-ledger verification and activates
  the pinned runtime.

The local RC now includes the first, deliberately non-destructive part of this
assistant in **Models & Providers**:

- a broad no-secret chooser for LLM/VLM, code, embedding/reranking, image,
  TTS, ASR/alignment, pose, talking-head, and LipSync candidates;
- a presenter-model preference list which distinguishes executable managed
  packages from research-only candidates such as EchoMimicV3 Flash,
  LatentSync 1.5, and NVIDIA LipSync Private Access;
- a local existing-folder field which proves only that a directory exists. It
  does not read, execute, copy, trust, or activate its contents; and
- named, switchable provider/model preference profiles per writing, research,
  images, motion, voice, transcription, presenter, and LipSync medium.

The preference file lives under application data and contains no credentials.
API keys remain in the OS credential vault. Multiple packs may coexist on disk,
but a presenter engine changes only after a successful **Use model** activation.
Disk and safe system-RAM caching are acceptable for this non-latency-critical
product, while the scheduler keeps one GPU-heavy family active at a time.

The manager records pinned revisions, exact byte counts and SHA-256 hashes,
requires the declared license acceptances, resumes `.part` files, and publishes
only complete verified packs. The Rust download manager owns the durable queue,
receipts, staging, activation ledger, and rollback. A supervised Python
installer performs the package-specific filesystem work. MuseTalk deliberately
stops in **downloaded, verified, quarantined** state; its upstream checkpoint
format and remaining dependency review prevent activation. The manager never
substitutes a mutable upstream snapshot.

### Presenter/LipSync model chooser

The executable managed choice is **SoulX-FlashHead Pro**. Downloading stages its
pinned runtime; **Use model** verifies the complete ledger and switches the
active presenter engine only after a `Ready` result. Eight bundled portraits
have exact portrait-hash and model-revision animation qualifications. A custom
fictional portrait becomes eligible only after the user adds it to the cast,
runs the short local SoulX preview, plays the result, and accepts that exact
portrait hash, engine, model revision, and output hash.

MuseTalk 1.5 remains visible as quarantine-only and cannot run. EchoMimicV3
Flash, LatentSync 1.5, and NVIDIA LipSync remain research or preference entries,
not installed execution routes. An existing-folder entry records a path for
future validation; it does not trust or activate arbitrary model files.

Packages can coexist on disk. Only a verified activation changes the active
presenter engine, and a failed activation leaves the previous working engine in
place. Model-dependent presenter outputs remain tied to their exact engine and
revision so a later accepted change can invalidate only affected descendants.

### Historical MuseTalk delivery encoder policy

MuseTalk 1.5 upstream currently hard-codes `libx264` for its final video/audio
mux. The quarantine spike designed a brokered encoder selection rather than
carrying that choice into an MIT/LGPL-first managed runtime. This remains a
non-executable design record while MuseTalk is quarantined.

Selection is based on a real, pinned-FFmpeg one-frame encode—not the encoder
name merely appearing in `ffmpeg -encoders`—and has one immutable priority:

1. `h264_nvenc` after its real hardware/API probe succeeds;
2. `h264_mf` only with Media Foundation hardware encoding forced;
3. `libx264` only from the optional separately installed GPL runtime pack,
   after an explicit license approval is durably recorded.

Fallbacks are never silent. The attempt ledger records each encoder, result,
diagnostic code, final choice, GPL pack ID and consent ID when applicable. An
NVENC driver/API mismatch tells the user to update the NVIDIA driver, restart
Windows and rerun Diagnostics. If neither hardware encoder works and the GPL
pack is absent or unapproved, presenter generation blocks instead of selecting
an unapproved software codec.

## Verification protocol before marking a profile supported

Each candidate needs a pinned model/runtime manifest and a short, deterministic
fixture run covering load time, peak VRAM, peak RAM, tokens/sec or realtime
factor, output hashes, locale behavior, cancellation, unload/reload, and one
crash/restart. For LipSync, add face detection/identity preservation, A/V drift,
mouth-sync scoring, seam checks across chunks, and presenter consent/disclosure
checks.

Functional tests may run in G-Helper Silent mode with CPU boost disabled. Any
performance number must record that profile, AC/battery state, temperature,
background load, driver, runtime, model revision, quantization, context, and
seed. Peak characterization requires a separate approved power profile; Alystria
does not change it automatically.

Unlisted research candidates remain `pin-required` or `benchmark-required`.
That boundary does not apply to the reviewed SDXL and SoulX managed routes
described above; their availability is still conditional on an exact successful
install, hardware/runtime checks, and durable activation receipts.
