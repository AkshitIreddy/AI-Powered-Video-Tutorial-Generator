# Windows + NVIDIA runtime audit

## September 8 compatibility correction

The packaged 9.0.1 build was independently reproduced failing both one-frame
1080p H.264 and HEVC NVENC probes on driver 581.29: required API 13.1,
available API 13.0. The integrated native HEVC export also failed at its probe,
before promotion. Earlier H.264 success can use the renderer's QSV fallback;
it does not establish NVENC compatibility.

The replacement candidate is BtbN's dated LGPL shared FFmpeg 8.1.2 build
`n8.1.2-51-g7ba069f4f1-20260907`. Both one-frame NVENC probes passed on this
machine under the shared GPU guard. Full integrated export qualification
remains pending. No driver was changed. The older system GPL build was used
only as a diagnostic comparator and is not packaged.

The repository runtime manifest pins the 70,835,200-byte archive, all ten
binary/DLL files, and its LGPL-3.0 license. Packaging verifies these inputs
and copies only the pinned files. Export identity now includes the installed
Node, Chromium, and FFmpeg payloads, including shared libraries, so a
toolchain change invalidates old native export jobs and render cache entries.

Primary sources: [dated build archive](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-07-15-39),
[BtbN NVIDIA header selection](https://github.com/BtbN/FFmpeg-Builds/blob/master/scripts.d/50-ffnvcodec.sh),
[NVIDIA API 13.0 requirements](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/read-me/index.html),
[API 13.1 requirements](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/read-me/index.html).
Local receipts are in
`E:\temp\AI Video Tutorial Generator\build\ffmpeg-candidate-20260908`
(`candidate-verification.json` and `one-frame-nvenc-probes.json`).

## September 8 colour-metadata retake

The complete 180-second native H.264 encode selected `h264_nvenc` and encoded
all 5,400 frames, but the unchanged delivery QA rejected its missing transfer
and primaries tags (`bt709/unknown/unknown`). Job
`1a84146b-c7c0-43fe-b378-ce6d8fea0cbf` failed without promotion. Normal native
shutdown passed with no remaining owned processes; the GPU marker returned to
`no`. This is a failed media qualification, not a successful master.

Three-frame encodes from the actual untagged RGB FFV1 composite reproduced
the issue in both H.264 and HEVC. Output stream flags alone were insufficient.
The delivery plan now explicitly converts to limited-range Rec.709 YCbCr and
sets sRGB transfer/Rec.709 primaries on the encoder frames. It retains stream
flags for muxers and the strict QA gate. The filter pixel format is allowlisted
before interpolation. This follows FFmpeg's [scale and setparams contracts](https://ffmpeg.org/ffmpeg-filters.html#setparams).

The actual generated source plan passed three-frame output probes for H.264
8-bit, HEVC 8-bit and 10-bit, and VP9 8-bit: each reports `bt709`,
`iec61966-2-1`, `bt709`, and limited range. Renderer planner/executor source
checks passed 25 tests with three opt-in media tests skipped; the real source
plan probes are separate evidence. Rebuilt full native acceptance remains
required. Evidence:

- `E:\temp\avt-final-media-inspection-20260907\encoder-color-probes-20260908`
- `E:\temp\avt-final-media-inspection-20260907\delivery-plan-color-regression-20260908`
- `E:\temp\avt-final-media-inspection-20260907\failed-color-master-media-inspection-20260908`

Independent decoded-audio measurements on the rejected video found -16.24
LUFS, -1.96 dBTP, zero clipped samples, and 180 seconds of media. These do
not override the failed colour gate or constitute auditory listening.

## Earlier snapshot

Research and machine-verification snapshot: **2026-08-30**.

This audit asks which inference and media runtimes Alystria should prefer on
native Windows with an NVIDIA GPU. “Newest” is not synonymous with “best.” A
runtime is preferred only when it is native to the target, headless,
license-compatible with Alystria's distribution boundary, reproducibly
identifiable, and proven against the installed driver and exact workload.

## Verified reference machine

- Windows laptop GPU: **NVIDIA GeForce RTX 4080 Laptop GPU**, Ada compute
  capability **8.9**, **12,282 MiB** VRAM.
- NVIDIA driver: **581.29**.
- Installed LM Studio engine: **CUDA 12 llama.cpp 2.31.2**, backed by llama.cpp
  b10662 / commit `18443257a`; its manifest targets compute 8.9 and exposes a
  `llama-server.exe` engine-protocol server.
- Verified presenter runtime: Python 3.10.6, PyTorch **2.0.1+cu118**, CUDA runtime
  **11.8**, cuDNN **8.7**, MuseTalk 1.5, fp16. A real 1,172-frame inference run
  completed on this GPU.
- Packaged FFmpeg: n9.0.1 snapshot `9d4ca21220`, built 2026-08-19 with
  ffnvcodec/NVENC API **13.1**.
- Renderer capture profile: pinned Chromium 151, eight isolated pages, and
  DevTools' lossless PNG `optimizeForSpeed` mode. On the real 1,920 × 1,080,
  30 fps tutorial workload this increased authoritative-frame throughput from
  **4.42 fps to 8.14 fps** (about **1.84×** end to end). A focused 12-frame PNG
  encoder benchmark measured **4.94 fps versus 12.66 fps** (**2.56×**).

## Decision matrix

| Workload | Native-Windows default | Optional fast path | Explicit fallback | Decision |
|---|---|---|---|---|
| GGUF text/VLM | **llama.cpp CUDA 12** through headless LM Studio `llmster` or a pinned `llama-server` | Speculative decoding after a per-model quality benchmark | Vulkan, then CPU | Preferred Windows/NVIDIA local-text profile. Never launch the LM Studio GUI from Alystria. |
| MuseTalk presenter | **Pinned PyTorch CUDA eager + fp16** | Separately benchmarked CUDA 12 migration; ONNX/TensorRT subgraphs only after pixel/A-V parity | No production CPU timing claim | Keep the proven cu118 environment for RC. Do not upgrade merely to match the LLM runtime. |
| Embedding/reranking/compact ONNX | **ONNX Runtime CUDA EP**, CUDA before CPU | TensorRT EP with engine/timing caches after output-parity tests | WinML/DirectML, then CPU | CUDA is the NVIDIA default; WinML is the broad-hardware Windows fallback. |
| High-throughput LLM serving | Not a native default | **vLLM or TensorRT-LLM in WSL2/Linux**, opt-in | llama.cpp native | Linux-only stacks may win server throughput but do not fit the portable native-Windows baseline. |
| H.264 delivery | **NVENC after a real one-frame probe** | QSV hardware encode | Approved optional GPL x264 pack | Current packaged FFmpeg and driver are incompatible; QSV is truthful but not the desired NVIDIA result. |
| Rendering/composition | Pinned Chromium + deterministic renderer, 8-page capture pool, lossless speed-optimized PNG | Hardware decode/encode where probed | software composition | Keep rendering separate from model runtimes, retain per-frame hashes, and record every encoder choice. |

## LM Studio screenshot verdict

For this RTX 4080 laptop, the screenshot's **CUDA 12 llama.cpp (Windows)
2.31.2** is the correct engine to prefer over CPU, Vulkan, and the older generic
CUDA line. The installed engine manifest targets Ada 8.9 directly, and LM
Studio's runtime state shows CUDA 12 was auto-selected and 2.31.2 is the most
recently used version.

Alystria should integrate this as an **external headless endpoint**, not copy
LM Studio binaries or depend on its GUI. A project snapshot must record:

1. endpoint class (`lmstudio-llmster` or direct `llama-server`), loopback URL,
   and OpenAI-compatible contract version;
2. exact runtime ID/version and upstream llama.cpp commit;
3. exact GGUF SHA-256, quantization, context, GPU offload, KV-cache type, and
   optional draft-model identity; and
4. a local benchmark receipt for schema compliance, output quality, first-token
   latency, tokens/s, peak VRAM/RAM, cancellation, and unload/reload.

Vulkan remains a recovery path and cross-vendor option, but it should not
outrank CUDA on a supported NVIDIA GPU. CPU is a last resort whose slower
estimate must be shown before execution.

## Why one CUDA version must not govern every stage

CUDA applications carry workload-specific library and ABI boundaries. NVIDIA
documents minor-version compatibility within a major family, while PyTorch,
cuDNN, custom extensions, ONNX Runtime, TensorRT, llama.cpp, and NVENC add
their own requirements. Consequently:

- llama.cpp CUDA 12.8 is a good fit for current GGUF inference;
- the verified MuseTalk environment remains PyTorch 2.0.1+cu118 until a newer
  environment passes portrait, mouth-sync, identity, A/V drift, and
  cancellation tests;
- `torch.compile` is not an RC requirement on native Windows because upstream
  Windows/Triton support remains less mature than Linux; and
- FlashAttention must not be assumed to be a safe Windows optimization. Its
  official project still describes Windows support as requiring more testing.

The scheduler should keep one GPU-heavy family active at a time. A local LLM
must unload before MuseTalk or a diffusion image model claims the 12 GB device.

## Confirmed NVENC incompatibility

The packaged FFmpeg advertises `h264_nvenc`, but the real probe fails:

```text
Driver does not support the required nvenc API version.
Required: 13.1  Found: 13.0
The minimum required Nvidia driver for nvenc is 610.00 or newer
```

The same machine successfully encodes a one-frame NVENC sample with an older
system FFmpeg build, proving the RTX GPU and current driver can encode H.264.
That system build is GPL-enabled and is **evidence only**, not a file Alystria
may silently bundle.

Release resolution is one of:

- publish a pinned LGPL-compatible FFmpeg build compiled against an NVENC API
  supported by Alystria's declared driver floor; or
- raise the NVIDIA driver floor to 610+ after that production driver is
  available and passes the full render suite.

Until then, the real-probe → QSV fallback is correct and must remain in
provenance. Seeing `h264_nvenc` in `ffmpeg -encoders` is not readiness.

## Runtime policy to implement

- Native Windows + supported NVIDIA: CUDA first, workload-specific pinned
  runtime, no GUI process, no silent WSL or cloud substitution.
- Headless local LLM: prefer LM Studio `llmster`/engine-protocol runtime or an
  independently pinned llama.cpp server; bind to loopback by default.
- WSL2: expert opt-in for Linux-only vLLM/TensorRT-LLM workflows, with separate
  storage, network, GPU lease, update, and support disclosures.
- ONNX: CUDA EP → CPU on NVIDIA; TensorRT EP only for verified subgraphs and
  cached engines tied to GPU/runtime identity; WinML/DirectML for broad-vendor
  fallback.
- PyTorch: preserve the exact tested wheel/CUDA/cuDNN/dependency set.
  Migrations are new runtime revisions, not in-place package upgrades.
- Encode: create a real sample during the capability probe after any driver or
  runtime change.
- Long-form frame capture: use the bounded eight-page pool on the Windows/NVIDIA
  package, DevTools' lossless speed-optimized PNG encoder, a four-hour worker
  bound, and cooperative job cancellation that terminates the renderer process
  tree. Rebenchmark after Chromium, GPU driver, resolution, or scene-system
  changes rather than assuming the reference-machine ratio.

## Primary-source ledger

The conclusions above were checked against these first-party sources. Model
cards and project repositories are still claims that require local measurement.

### LM Studio and llama.cpp

1. [LM Studio application and runtimes](https://lmstudio.ai/docs/app)
2. [LM Studio headless mode / llmster](https://lmstudio.ai/docs/developer/core/headless)
3. [LM Studio runtime CLI](https://lmstudio.ai/docs/cli/runtime/runtime)
4. [LM Studio developer APIs](https://lmstudio.ai/docs/developer)
5. [LM Studio CUDA 12 / RTX 50 release](https://lmstudio.ai/blog/lmstudio-v0.3.15)
6. [llama.cpp project and CUDA backend](https://github.com/ggml-org/llama.cpp)
7. [llama.cpp installation](https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md)
8. [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
9. [llama.cpp Windows CUDA build workflow](https://github.com/ggml-org/llama.cpp/blob/master/.github/workflows/build-cuda-windows.yml)
10. [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases)

### NVIDIA, ONNX, and Windows inference

11. [CUDA minor-version compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html)
12. [CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/)
13. [CUDA driver/toolkit/architecture matrix](https://docs.nvidia.com/datacenter/tesla/drivers/latest/cuda-toolkit-driver-and-architecture-matrix.html)
14. [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/)
15. [ONNX Runtime CUDA EP](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
16. [ONNX Runtime TensorRT EP](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)
17. [ONNX Runtime TensorRT RTX EP](https://onnxruntime.ai/docs/execution-providers/TensorRTRTX-ExecutionProvider.html)
18. [ONNX Runtime DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
19. [Windows ML execution providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers)
20. [Windows AI runtime FAQ](https://learn.microsoft.com/windows/ai/faq)
21. [TensorRT installation](https://docs.nvidia.com/deeplearning/tensorrt/latest/installing-tensorrt/installing.html)
22. [TensorRT support matrix](https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html)

### Throughput stacks and model runtimes

23. [vLLM GPU installation and Windows status](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)
24. [TensorRT-LLM installation](https://nvidia.github.io/TensorRT-LLM/latest/installation/index.html)
25. [TensorRT-LLM support matrix](https://nvidia.github.io/TensorRT-LLM/legacy/reference/support-matrix.html)
26. [PyTorch Windows installation](https://pytorch.org/get-started/locally/)
27. [PyTorch automatic mixed precision](https://docs.pytorch.org/docs/stable/accelerator/amp.html)
28. [PyTorch native-Windows `torch.compile` tracking](https://github.com/pytorch/pytorch/issues/122094)
29. [FlashAttention platform requirements](https://github.com/Dao-AILab/flash-attention)
30. [MuseTalk official implementation](https://github.com/TMElyralab/MuseTalk)
31. [MuseTalk inference entrypoint](https://github.com/TMElyralab/MuseTalk/blob/main/scripts/inference.py)

### Media encode

32. [NVIDIA Video Codec SDK](https://developer.nvidia.com/video-codec-sdk)
33. [NVIDIA FFmpeg integration](https://developer.nvidia.com/ffmpeg)
34. [Chrome DevTools `Page.captureScreenshot`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot)
