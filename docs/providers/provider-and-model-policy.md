# Provider and model policy

## Capability contracts

Alystria owns provider-neutral contracts for language/research, image, licensed media, generated motion, speech, presenter, alignment, transcription, embeddings, and reranking. Adapters translate those contracts to vendor SDKs, normalize usage, and return typed capability limitations. Native structured output is used when available and is always revalidated locally.

Planned launch families are:

- Language/research: OpenAI, Anthropic, Gemini, NVIDIA NIM hosted preview, and OpenAI-compatible local endpoints.
- Images: OpenAI image generation, Gemini image generation, FLUX API, Recraft, and local FLUX.
- Licensed media: Openverse and Pexels.
- Generated motion: Runway and Gemini video models, only when deterministic animation is inadequate.
- Speech: ElevenLabs, OpenAI, Azure, Google, Qwen TTS, and Kokoro.
- Presenters: HeyGen, Azure, Tavus, and local LivePortrait/MuseTalk workflows.
- Alignment/transcription: Montreal Forced Aligner, WhisperX, and Whisper-family verification.

This list is a target, not a claim that every adapter is implemented or currently available. Catalog entries are capability-gated.

### NVIDIA hosted preview is not self-hosted NIM

`nvidia-nim` is the NVIDIA-hosted API Catalog preview boundary. One OS-keyring
credential can reach several currently enabled catalog families, while each
exact model still requires an account-access/rate-limit check. Alystria's
adapter fixes chat/VLM and embedding endpoints, uses the documented ranking
endpoint, and permits visual calls only through audited exact model/endpoint
pairs. It never accepts an arbitrary URL/path or silently substitutes a retired
model. The current embedding default is `nvidia/nemotron-3-embed-1b`; retired
`nvidia/nv-embed-v1` is denied. `/v1/models` discovery does not imply that every
returned ID supports the chat contract, so capability allowlists remain
separate.

The 2026-08-28 FLUX.2 Klein hosted smoke also exposed catalog/schema drift: the
live endpoint rejected the reference page's `mode` field and a zero guidance
scale, while the exact request with no `mode`, `cfg_scale: 1.0`, one sample, one
step, and explicit dimensions succeeded. That audited shape is pinned in the
adapter and its contract test; a future rejection is surfaced as drift, not
worked around by sending arbitrary fields or changing models.

The hosted preview is development/testing-only and accepts public or synthetic
payloads in Alystria. The current [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)
prohibit production and confidential, sensitive, or personal inputs; make
credits/limits variable; and permit certain de-identified content and logging
uses for product/AI improvement, security, and fraud handling. The UI must show
that conflict instead of collapsing it to a “no training” badge. Explicit terms,
region/retention, model-access, and zero-dollar preview budget approvals are
required; rate limits remain a separate availability gate.

Downloaded/self-hosted NIM microservices require their own NVIDIA AI Enterprise
entitlement, infrastructure, model license, and privacy assessment. They are a
separate provider ID and execution boundary if implemented later; a hosted
preview key never turns a cloud route into Local mode.

### NVIDIA LipSync is a separate local candidate

NVIDIA LipSync is not enabled by the ordinary `nvidia-nim` hosted-preview key.
The model card marks it downloadable and requires the AI for Media Private
Access Program. The current [support matrix](https://docs.nvidia.com/nim/maxine/lipsync/latest/support-matrix.html)
requires an NVIDIA GPU with Tensor cores and NVENC/NVDEC, and lists Ada/Lovelace
architecture compatibility; its optimized consumer table names RTX 4090, RTX
5090, and RTX 5080 but not the RTX 4080 Laptop. NVIDIA's model card lists
Windows 10/11 among preferred operating systems, while the deployment guide is
container-oriented and requires Linux NVIDIA driver 571.21+, Docker, and the
NVIDIA Container Toolkit. The published stack includes CUDA 12.8.1, cuDNN
9.7.1.26, TensorRT 10.9.0.34, Triton 2.56.0, and DeepStream 8.0, with one GPU
and gRPC normally exposed on port 8001. Alystria therefore keeps LipSync as a
capability-gated local sidecar candidate: the Windows RTX 4080 Laptop/12 GB
target has not been benchmarked, and no Docker/WSL/NIM runtime is installed or
claimed supported in this RC.

LipSync animates an existing face image/video against mono 16 kHz speech; it is
not a voice selector or TTS engine. Presenter consent, source rights, and
synthetic-media disclosure remain mandatory before a future adapter can run.

## Freshness and evidence

Provider facts drift. Each catalog entry records adapter version, model identifier, capability flags, endpoint/region, payload limits, retention/training policy URI, price unit, price, currency, `lastVerifiedAt`, deprecation date, and evidence URI. The application must not infer a current model name or price from an older project.

Primary references include [OpenAI models](https://platform.openai.com/docs/models), [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint), [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Gemini video generation](https://ai.google.dev/gemini-api/docs/video), [NVIDIA NIM](https://developer.nvidia.com/nim), [NVIDIA API quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart), [NVIDIA LLM APIs](https://docs.api.nvidia.com/nim/re/reference/llm-apis), [NVIDIA visual APIs](https://docs.api.nvidia.com/nim/reference/visual-models-apis), [Runway models](https://docs.dev.runwayml.com/guides/models/), [FLUX documentation](https://docs.bfl.ai/flux_2/flux2_overview), [Openverse API](https://docs.openverse.org/api/reference/made_with_ov.html), and [Pexels license](https://www.pexels.com/license/).

Model names in a plan are not permanent defaults. Deprecated or retired models are disabled by catalog policy; they are not silently remapped. In particular, the application does not add a new Sora integration based on a retiring interface, and deprecated Imagen generations are not treated as the Gemini image default.

## Approval and routing

Automatic routing selects only configured and explicitly approved providers. Before the first content-bearing call, the user sees provider/model, payload classes, local/cloud boundary, endpoint/region, retention/training summary, expected quantity, upper-bound cost, and whether the result may be cached or reused.

Hard budgets are evaluated against an upper bound, not an optimistic mean. Unknown or stale pricing blocks billable work. Usage records distinguish reserved estimate, provider-reported usage, reconciled cost, retries, cache hits, and uncharged failure.

Provider fallback is allowed only within an approval set whose members share the accepted content classification and policy. Cross-provider critique is disabled by default and enabled only under Maximum quality with separate disclosure.

## Local model manifests

Models are downloaded through the runtime manager and never bundled in the application installer. A manifest records model family, immutable source/revision, expected files and SHA-256 hashes, total bytes, license, attribution, architecture, quantization, context limits, runtime version, VRAM/RAM estimates, supported tasks/locales, and benchmark status.

Unsafe serialization and arbitrary code are disabled by default: prefer safetensors/GGUF and do not enable pickle or `trust_remote_code`. A model with unknown license, mutable revision, hash mismatch, unsupported runtime, or insufficient resources cannot be activated.

The reference 12 GB profile targets one GPU-heavy model family at a time. Candidate families include a roughly 9B quantized local LLM/VLM, compact embedding and reranking models, quantized/offloaded FLUX, compact Qwen TTS or Kokoro, Whisper transcription/forced alignment, and MuseTalk/optional lip-sync tooling. A family is marked “supported” only after the actual reference laptop passes deterministic fixtures under recorded power and thermal conditions.

## Resource scheduling

The scheduler knows estimated VRAM, system RAM, GPU compute exclusivity, disk footprint, and warm-up cost. It evicts idle model families before launching incompatible work, preserves resumable job state, and exposes the reason a task is blocked. CPU fallback is explicit and estimates are updated rather than pretending GPU performance.

## Contract tests

Every adapter is tested against the same recorded contract suite: schema compliance, idempotency and reconciliation, cancellation, timeout, retry classification, streaming assembly, usage normalization, rights/provenance capture, safety refusal, policy disclosure, and redaction. Live BYOK tests are opt-in and never part of an unattended default test run.
