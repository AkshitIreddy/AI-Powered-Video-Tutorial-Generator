# Local model profiles for the 12 GB RTX 4080 Laptop target

Research snapshot: **2026-08-28**. These are evidence-backed candidates and
installation policies, not a claim that every model is already pinned,
downloadable, or benchmarked in Alystria. No model weights are bundled in the
installer or downloaded by this worktree.

The workload-specific native-Windows runtime decision, current RTX 4080 laptop
probe, LM Studio CUDA 12 verdict, and confirmed NVENC API mismatch are recorded
in [Windows + NVIDIA runtime audit](windows-nvidia-runtime-audit.md).

## Recommendation in one sentence

Ship a small Alystria installer, then offer a first-run **Local model setup**
assistant with hardware/storage checks, a curated profile selector, an existing
folder option, and a skip/cloud option. API-backed LLM, TTS, ASR, research, and
image stages remain usable without local weights; the only prominent optional
download is a user-selected talking-head/LipSync pack. Downloaded weights
belong in the managed app-data model cache, not the project repository or
installer.

Bundling weights would make the installer multi-gigabyte, couple every user to
one GPU/runtime/license combination, and make updates and revocations unsafe.
The model manager already has the required primitives: signed manifests,
license acceptance, resumable `.part` downloads, byte/hash verification,
atomic activation, rollback, health checks, and one-heavy-family scheduling.

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

## LipSync decision for Alystria

The local default should be **EchoMimicV3 Flash if the 12 GB benchmark passes**;
otherwise use **MuseTalk 1.5** for fast face-only presenter shots, with
LatentSync 1.5 as a quality comparison and NVIDIA LipSync as an optional
private-access sidecar. The director should generate a clean portrait/short
presenter clip, synthesize final dry narration, align it, then run lip-sync
only for selected presenter scenes. It must not lip-sync every scene.

EchoMimicV3 is the strongest evidence-backed first test for this laptop: its
official repository reports a 12G-VRAM Flash profile, 1.3B parameters, 8-step
high-quality generation, up to 768×768, partial-video controls for reducing
VRAM, Apache-2.0 licensing, and a quantified Windows package. Its tested GPUs
are still A100/RTX4090D/V100, so the RTX 4080 Laptop result must be measured
locally. It should be installed as an optional presenter pack, not loaded beside
the LLM or image generator.

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
5. For managed downloads, stage resumable `.part` files, verify every hash and
   signature, require license acceptance, atomically promote the complete pack,
   and retain rollback history. A failed or interrupted download never becomes
   active.
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
cannot download. The currently declared packages are SDXL, FLUX.2 Klein,
Z-Image Turbo, and MuseTalk. SDXL has an execution-ready recipe; the other
packages retain their explicit runtime/hardware activation restrictions.

The local RC now includes the first, deliberately non-destructive part of this
assistant in **Models & Providers**:

- a broad no-secret chooser for LLM/VLM, code, embedding/reranking, image,
  TTS, ASR/alignment, pose, talking-head, and LipSync candidates;
- a separate presenter/LipSync selector that can prefer EchoMimicV3 Flash,
  MuseTalk 1.5, LatentSync 1.5, NVIDIA LipSync Private Access, or a future
  verified external pack;
- a local existing-folder field which proves only that a directory exists. It
  does not read, execute, copy, trust, or activate its contents; and
- named, switchable provider/model preference profiles per writing, research,
  images, motion, voice, transcription, presenter, and LipSync medium.

The preference file lives under application data, contains no credentials, and
is not a project routing approval. API keys remain in the OS credential vault;
every project still needs a separate payload/privacy/retention/region
approval before a cloud request can occur. Multiple packs may remain selected
or eventually installed. Disk and safe system-RAM caching are acceptable for
this non-latency-critical product, while the scheduler keeps one GPU-heavy
family active at a time.

The screen now offers one deliberately narrower managed path for the exact
MuseTalk 1.5 artifact set verified during the RC spike. It records the pinned
revisions, exact byte counts and SHA-256 hashes, requires acceptance of the
main repository's immutable MIT license hash, resumes `.part` files, and stops
in a **downloaded, verified, quarantined** state. Several upstream `.pth` files
remain unsafe to load, and dependency licenses still need final review, so this
path cannot activate a model or start inference. Other candidates remain
blocked when no exact declaration is available; Alystria never substitutes a
mutable upstream snapshot.

The Python model manager remains the only activation owner. It can make a pack
active only after a signed manifest, every required license acceptance, hashes,
hardware preflight, atomic promotion, and rollback record pass.

### Presenter/LipSync model chooser

The setup assistant must present these as separate user choices, with the
hardware probe's recommendation highlighted but never silently selected:

- **EchoMimicV3 Flash** — expressive talking head/upper-body motion; official
  12G-VRAM Flash profile; first benchmark target for this laptop.
- **MuseTalk 1.5** — fast face-region lip-sync specialist; recommended fallback
  when EchoMimicV3 does not fit or the user wants shorter presenter clips.
- **LatentSync 1.5** — slower diffusion quality comparison; its official README
  states an 8 GB inference minimum, while 1.6 requires 18 GB and is excluded
  from this target profile.
- **NVIDIA LipSync** — only after AI for Media Private Access and local NIM
  runtime checks; it is not unlocked by the normal hosted NIM key.
- **Use an existing folder** — validate the selected pack's manifest, revision,
  hashes, license, runtime and path safety before it can be activated.

The user can keep multiple verified packs installed and switch the active pack
per project, lesson, or presenter profile. Switching a pack creates a new
candidate revision and invalidates only presenter clips, alignment/timing
descendants, scene renders, and final composition; it preserves narration and
accepted scenes. The selector shows disk size, VRAM estimate, supported locales,
rights/consent requirements, and exact reasons a pack is unavailable.

### MuseTalk delivery encoder policy

MuseTalk 1.5 upstream currently hard-codes `libx264` for its final video/audio
mux. Alystria does not carry that choice into its MIT/LGPL-first managed
runtime. The signed Alystria worker receives a brokered encoder selection in
its attempt manifest and must use the fixed mux helper rather than upstream's
direct mux call.

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

The current repository therefore leaves all local profiles `pin-required` or
`benchmark-required`, even where the model is likely to fit. That is deliberate:
download convenience must not become an unverified binary supply chain.
