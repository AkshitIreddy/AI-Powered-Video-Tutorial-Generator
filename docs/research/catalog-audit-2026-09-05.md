# Catalog, routing, and provider-brand audit — 2026-09-05

## Scope and evidence standard

This audit covers the desktop federated catalog, capability routing, local resource checks, cloud connection checks, curated catalog seeds, and provider marks. It compares the current implementation with the preserved v1 product, the `v1.0.0` tag, current repository documentation, the `see` and `see me` handoffs, Git history, and current provider documentation.

The catalog uses a conservative evidence rule: a model identifier proves identity only. A capability is selectable only when a provider response, checked manifest, model card, or tested recipe names the corresponding operation. Tags and name fragments remain discovery hints and do not become execution claims.

## Findings and changes

### Execution-path compatibility

The previous compatibility evaluator merged local and cloud concerns. For a hybrid item it skipped both runtime checks and credential checks, which could make a model selectable even though neither route was usable. It also applied local OS, GPU, and VRAM failures to the entire item, blocking a valid connected cloud route.

Compatibility is now evaluated per eligible execution path:

- Local checks cover OS, GPU vendor, runtime versions, required artifacts, verified installation, and live resource fit.
- Cloud checks cover the configured provider connection. They do not consume local RAM or VRAM budgets.
- The evaluator chooses a ready path first, then a path that needs setup, and only then a blocked path. Equal candidates prefer local execution.
- The result records the selected boundary, and the model card reports the currently usable path.
- A downloadable or discovered local item without a verified installation cannot be selected or added to routing.
- Routing selectors show readiness and disable candidates that have not passed compatibility.

This keeps discovery, installation, and execution distinct. An index row is not proof that bytes exist locally or that a provider operation will accept the job.

### Credentials and terms

The generic cloud adapter previously set `trust.gated` and `termsAccepted` from `credentialConfigured`. A stored API key does not prove that a user accepted publisher terms, and a missing key does not prove that special model terms exist. The adapter now keeps those fields neutral and expresses missing access through the provider-connection check. The endpoint may still report catalog availability as `gated` until credentials are configured.

### Curated Qwen3-TTS entry

The earlier `Qwen/Qwen3-TTS-0.6B` identity does not match a current official checkpoint. The curated row now names `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`, links directly to its Qwen model card, and identifies `qwen-tts` as the runtime. The prior 4 GB VRAM estimate was removed because the official material reviewed here does not publish a Windows VRAM requirement that can be applied safely to this machine. Resource fit remains unknown until a measured preflight.

The model card documents ten languages, nine built-in speakers, the `qwen-tts` package, PyTorch loading, BF16, and an optional FlashAttention example. It also reports that the model is not currently deployed by a Hugging Face Inference Provider. The local recipe must therefore remain an install-and-verify candidate rather than a hosted fallback claim.

### Vetted local image downloads and LoRA matching

The earlier FLUX.2 row was a search recipe with an unpinned revision, unknown license, an unsupported four-operation capability claim, and a nominal 12 GB VRAM value. It did not identify the companion text encoder or VAE, and it could not prove that a usable workflow could be installed. That row has been replaced with four downloadable, immutable catalog items:

| Catalog item | Pinned artifacts | Download size | Hardware statement |
| --- | --- | ---: | --- |
| Stable Diffusion XL Base 1.0 | Official `sd_xl_base_1.0.safetensors` at revision `462165984030d82259a11f4367a4eed129e94a7b`, SHA-256 `31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b` | 6,938,078,334 bytes | Hardware-verified on the 12,282 MiB RTX 4080 Laptop reference PC with the pinned low-VRAM recipe; every different install still needs preflight. |
| SDXL 1.0 Offset Example LoRA | Official `sd_xl_offset_example-lora_1.0.safetensors` at the same revision, SHA-256 `4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f` | 49,553,604 bytes | The pinned recipe passed, but visual review found a minor hand/watch artifact outside the headshot crop, so this remains optional. It declares only `sdxl-1.0` as a compatible base. |
| FLUX.2 Klein 4B FP8 bundle | BFL FP8 diffusion SHA-256 `97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6`; Comfy FP4 text encoder SHA-256 `3eab03a77adb0ee5304a4e677d5c10ac22f9049c1d7c894adca4f8bb39206ca8`; VAE SHA-256 `868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3` | 8,255,049,810 bytes | **12 GB candidate / CPU offload required.** The publisher's roughly 13 GB guidance is not a measured fit on the reference PC. |
| Z-Image Turbo INT8 + FP4 bundle | INT8 conv-rotation diffusion SHA-256 `be517ebd47c912a5626a588e1aeea43e6be4a43c0cdcd2b48a2a780d9f358635`; FP4 text encoder SHA-256 `7ca32dcf07dfe7692945d80fff86e3a74cb83c6206b9b223ac6836b939bb85d6`; VAE SHA-256 `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38` | 10,015,721,877 bytes | **12 GB candidate / CPU offload required.** The 12,309,866,400-byte BF16 diffusion artifact is excluded because its published target is 16 GB. |

The multi-file bundles pin ComfyUI v0.9.2 at commit `8f40b43e0204d5b9780f3e9618e140e929e80594`. Every required artifact records its destination, publisher repository, immutable repository revision, and LFS SHA-256. Their VRAM and RAM estimates remain null until a measured preflight supplies evidence. The catalog advertises `image.generate` only; it does not infer editing, inpainting, or reference-image execution from the family name.

The tested recipe ID is `comfy-sdxl-1.0-portrait-v1`. With Python 3.12.2, torch 2.14.0+cu130, `--lowvram --disable-api-nodes`, seed 20260905, 1024×1024, 25 steps, DPM++ 2M Karras, and CFG 6.5, the cold base run completed in 86.234 seconds and the warm offset-LoRA run in 29.984 seconds. Their output hashes are respectively `320f60bb3ea8623fbfd27852bf4c2578e19c40d55cac6f0ec0902f419e18f8a4` and `bbda233b4d1fc1dfe069bf73d65ed1b910187404a0775962d0b6bf50905ab944`; the proof manifest hash is `a471db5d44779a92acd23042bfbe7e2ef4ed9b83f242a97ed79ccfcf3e7ee420`. FLUX.2 Klein and Z-Image remain unmeasured candidates.

The native download manager now delegates local-image installation to the packaged pipeline's exact `ComfyBundleInstaller` CLI under `<Models>/comfyui-local`. The stable ComfyUI v0.9.2 runtime, model files, and post-install preflight are one managed action. A reuse proof against the existing E: SDXL lab returned `runtimeReady: true`, the expected recipe, `executable: true`, and 2/2 verified model files. The checkpoint and LoRA modification times stayed unchanged and no runtime archive appeared, proving that the action reverified the installed multi-gigabyte files instead of downloading duplicate copies. The native Rust integration suite passed 61/61 after the active verified worker executable was bound to the manager.

### Cloudflare Workers AI image route

The provider catalog and desktop routing now contain one Cloudflare operation: `image.generate` through `@cf/black-forest-labs/flux-1-schnell`. Account ID is nonsecret provider configuration and the API token remains an OS-vault reference. The adapter fixes the Cloudflare host and model path, rejects malformed Account IDs before transport, bounds prompts and steps to the provider schema, rejects reference-image requests, enforces the provider policy and request budget, and validates the returned JSON envelope, base64 payload, and JPEG boundary.

The official model input schema exposes `prompt` and `steps`; official examples also use `seed`. It does not expose width or height. A live request through the real adapter therefore used the provider-native size rather than manufacturing a 512-pixel control. The successful output was a 1024×1024 JPEG (144,946 bytes, SHA-256 `c23d98ed0befef5724bbf308c2720f70ed1b4da392e261383b7afdfec6844ebf`) with a provider request identifier. Two HTTP calls were made: the first returned HTTP 400 because the one-off authorized-key parser carried a section into a later generic token; the corrected one-retry parser succeeded. No further Cloudflare requests were made.

The price guard uses Cloudflare's published $0.0000528 per 512×512 tile plus $0.0001056 per step. A 1024×1024 output at four steps is bounded at 634 micros ($0.000634, rounded upward). The provider's free allocation and paid overage are service-account facts, not a promise that any particular project call will be free.

### Groq, Mistral, and OpenRouter structured writing

OpenAI-compatible request syntax does not prove that every model supports JSON Schema. Each new writing route therefore fixes the provider host and allows one model whose provider-controlled documentation or live model metadata names structured output:

| Provider | Exact model | Capability evidence | Price snapshot used by the hard-budget guard |
| --- | --- | --- | --- |
| Groq | `openai/gpt-oss-20b` | Groq lists the production model with JSON Schema Mode; strict structured output is documented for GPT-OSS 20B and 120B. | $0.075/M input tokens and $0.30/M output tokens. |
| Mistral AI | `mistral-small-2603` | The Mistral Small 4 model page lists Structured Outputs on `/v1/chat/completions`. | $0.15/M input tokens and $0.60/M output tokens. |
| OpenRouter | `z-ai/glm-5.2:free` | The live 2026-09-05 model list reported zero prompt/completion prices and both `response_format` and `structured_outputs`; the model page also names JSON-Schema support. | Zero in that dated model-list snapshot. Availability and free limits remain provider controlled. |

Authenticated read-only model-list requests confirmed that the exact Groq and Mistral IDs were available to the configured account. The OpenRouter model list was read without generation. The new adapter rejects unknown models and web-research requests before transport, uses provider-specific fixed hosts, adds strict JSON Schema, requires parameter-compatible upstream routing on OpenRouter, retains OS-vault credential references, parses usage, and rejects refusals or malformed JSON. These providers are available for writing; they are not presented as research routes. A later bounded production-adapter smoke is recorded below.

### Live structured-writing adapter smoke

On 2026-09-05, the exact `launch_structured_cloud_adapter` and production `UrllibTransport` path received one authorized call per provider. Each request contained only a public synthetic prompt asking for one neutral sentence, a strict one-property JSON Schema, and a 128-token output ceiling. Credentials were parsed from the authorized common key file only in process memory; they were absent from arguments, environment variables, output, and evidence. OpenRouter and Cloudflare were not called.

| Provider | Requested model | HTTP success | Schema result | Adapter token usage | Response SHA-256 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Groq | `openai/gpt-oss-20b` | Yes; accepted 2xx response | Valid strict JSON object | 198 input, 70 output | `a227e345d1bd5b56e332fbbae23a35942223002cd8c7bf7f9c826095c24396ba` | Returned model matched the requested model; adapter-accounted cost was 36 USD micros. |
| Mistral AI | `mistral-small-2603` | No | Not available | Not returned | Not available | The production adapter classified the first response as `RATE_LIMITED`; the smoke did not retry. |

### Removed provider capability claims

The Azure presenter flag was removed because the implemented Azure speech adapter rejects presenter input, and Google Cloud forced alignment was removed because the reviewed adapter offers transcription rather than a proven known-text forced-alignment operation. NVIDIA discovery still treats model-list identities as capability-unknown until an operation-specific check succeeds. The explicit NVIDIA routing matrix retains `audio.tts` for the separately implemented Magpie multilingual endpoint; it does not infer speech support from arbitrary NVIDIA model names.

### Provider marks

The app previously rendered reviewed artwork only for Hugging Face, NVIDIA, and Cohere. OpenAI, Anthropic, Gemini, and ElevenLabs fell back to letter tiles even in provider-owned catalog and connection contexts.

The following official assets are now bundled with governed metadata:

| Provider | Asset | Official source | Rendering decision | SHA-256 in this repository |
| --- | --- | --- | --- | --- |
| OpenAI | Black OpenAI wordmark | OpenAI logo download linked by the brand guide | Wordmark; neutral white badge; direct provider identification only | `4DBD0CBB5AC0894DA67090E3CEE9D800C9BA52E4B7CFE655558CBF7B2791F8D0` |
| Anthropic | Slate Anthropic symbol | Anthropic press kit | Symbol beside the provider name; neutral white badge | `C7BFDB2F6137925FEFD7D4EAAC445B0471DB7430754D46848684FC3726A56294` |
| Gemini API | Official Gemini API wordmark | Google AI for Developers site header asset | Wordmark; neutral white badge; direct Gemini API identification only | `B97C99382D39274FE69B6509FB89E10398992BAF125696BA11E80F7A0DA3A0DF` |
| ElevenLabs | Black ElevenLabs wordmark | ElevenLabs press page | Wordmark; neutral white badge | `920987FC4EFD655CE38DDE4DC1946E99FA3C9A052778473220701DFDA9A9C8DB` |

The assets retain their supplied SVG paths, proportions, and colors. Wordmarks are never combined with an extra visible provider name inside the catalog mark. Compact placements scale the whole wordmark and do not crop it. Metadata records ownership, official source, review date, and a future review date. Unknown providers continue to use an internal text monogram and never render unreviewed artwork.

OpenAI's guide allows a logo when it directly relates to OpenAI services, requires the supplied artwork to remain unmodified, requires ownership acknowledgement, and forbids implied endorsement. Google, Anthropic, and ElevenLabs marks are likewise used only to identify their own API/provider rows. They are subordinate to Alystria's product identity.

### Visual integration

The catalog previously carried its own dark navy theme inside a light lavender workbench. The module now inherits the workbench paper, surface, ink, line, indigo, teal, amber, and rose tokens. Cards and controls use white surfaces and lavender selection states, and provider art sits on a neutral white badge so black and multicolor official marks remain readable. Narrow-layout behavior and reduced-motion handling remain intact.

## Discovery rules by source

### Hugging Face

Use Hub search for discovery and identity. Request explicit fields rather than assuming the legacy `full=true` response shape. `pipeline_tag`, library, safetensors metadata, siblings, gated state, card license, and immutable revision are useful catalog evidence. For hosted routing, use `inference_provider`, `inferenceProviderMapping`, or the provider `/v1/models` response. Hosted capability is provider-specific; a repository's task tag alone does not prove that every inference provider serves it.

For local selection, locate an exact GGUF, MLX, safetensors, or other runtime-compatible artifact and pin its revision/hash. File existence, format, model family, license, and runtime compatibility remain separate checks.

### LM Studio

`lms get` is the preferred discovery/install surface because it reports runtime-compatible results and supports explicit quantization selection such as `@q4_k_m`. The app must still verify the downloaded artifact, load the model through LM Studio, and check the actual endpoint before marking it ready. Load settings such as context length, GPU offload, Flash Attention, and expert count affect resource fit and cannot be inferred from the model name.

### Provider model-list APIs

- OpenAI's Models API lists available model identifiers and ownership metadata. Capability routing must use the relevant model documentation or an operation probe; the list response is not a universal capability matrix.
- Anthropic's Models API provides available model identities. The app should route only Anthropic operations it actually implements and verifies.
- Gemini's Models resource exposes supported generation methods; these explicit methods are stronger evidence than name parsing.
- ElevenLabs' model-list response includes explicit booleans such as text-to-speech and voice-conversion support. Those fields can drive exact route mapping.
- Cohere's per-model response includes compatible `endpoints`, `default_endpoints`, deprecation, features, and context length. Use those fields rather than name patterns.
- NVIDIA NIM `/v1/models` identifies what the running container serves. The NIM's documented API family, OpenAPI schema, `/v1/metadata`, and readiness endpoint establish operations and deployment state. A model ID alone does not establish text, vision, image, video, or speech capability.

### Civitai

Preserve model ID and model-version ID separately. AIR, base model, file format, file size, SHA-256, virus scan, pickle scan, availability, creator permissions, and content rating are valuable evidence. Do not collapse a model-level listing into a verified local install. Region and authentication rules can silently change which rows appear, so a sync result is a time-stamped snapshot.

### Optional stock and visual-review routes

The desktop profile contract now exposes two optional media names. Writing and narration remain required; image generation is optional because the production compiler can render authored layouts and included project visuals without invoking an image provider:

- `stock` maps exactly to `media.licensed.search`. Openverse and Pexels both use the production adapter's model identity `licensed-media`; their provider IDs and API revisions keep them distinct. Openverse requires no credential and the workflow accepts only normalized CC0 results. Pexels requires an OS-vault API key and preserves its photographer, source, and Pexels-license record.
- `visualReview` maps exactly to `vlm.chat`. The enabled hosted model is `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, which is the sole model allowlisted by the current NVIDIA visual-language adapter. NVIDIA's current model page advertises a free hosted endpoint, image-and-text input, and JSON output. Its one authorized smoke reached the current transport but returned transient HTTP 503, so live semantic review remains unproven. The route remains restricted to public or synthetic inputs and does not decide copyright, consent, or publicity rights.

The retired `nvidia/nemotron-nano-12b-v2-vl` identity remains visible as unavailable so older saved profiles can explain what was selected. It is excluded from new routing and fails closed in the provider adapter because NVIDIA now reports its hosted endpoint as deprecated.

No local candidate was promoted from the legacy `vlm.review` catalog label. Those unpinned recipe candidates do not establish a working `vlm.chat` adapter. Profiles saved before these optional media existed remain valid because absent optional routes are skipped.

## Known integration limits

- The current Windows diagnostic snapshot has total dedicated VRAM but no live free-VRAM or DXGI budget/usage values. Local GPU resource results should remain unknown until live telemetry is available. Total VRAM must not be presented as currently available VRAM.
- Hosted operation metadata must arrive from the native discovery layer or a provider-specific adapter. A generic OpenAI-compatible model list cannot safely manufacture capabilities.
- Curated candidates other than the Qwen3-TTS row still use search links, unpinned revisions, unknown licenses, and unverified publishers. They remain review/install candidates and should not be advertised as ready.
- The four pinned local-image rows prove downloadable artifacts, licenses, and compatibility metadata. SDXL has a measured reference-PC recipe and a working managed installer/preflight. FLUX.2 Klein and Z-Image remain downloadable candidates and cannot become generation routes until their exact offload recipes pass hardware review.
- Cloud provider usage terms, model licenses, and repository gates are different facts. The current schema can record them, but each adapter must populate only what its source proves.
- A provider mark review is time-bound. Recheck source artwork and brand terms by the recorded `reviewAfter` date or sooner if a provider changes its guidance.

## Verification

Catalog tests cover local installation gating, runtime gating, hybrid local/cloud selection, cloud fallback around local resource failure, commercial-license blocking, route selector disabling, credential/terms separation, provider-art governance, query behavior, adapter normalization, and resource-policy behavior.

The latest focused desktop run on Node 24.20.0 passed all 53 catalog tests plus 19 provider-routing tests. The optional-route group covers legacy profiles, an image-generation-free authored-layout profile, public no-key Openverse selection, keyed Pexels gating, exact model allowlists, profile snapshots, and readable selector controls. Targeted ESLint and the full desktop TypeScript build passed after integration with the native medium/capability types. The included offline asset library added another 7 passing tests after the final four backgrounds and eight reusable elements were pinned. The structured Groq/Mistral/OpenRouter adapter plus root-catalog drift check passed 13 focused Python tests; strict mypy and Ruff had already passed for those modules.

## Primary-source ledger

1. [Hugging Face Inference Providers Hub API](https://huggingface.co/docs/inference-providers/hub-api) — provider filtering, provider mappings, and provider-specific model responses.
2. [Hugging Face Hub Python API](https://huggingface.co/docs/huggingface_hub/package_reference/hf_api) — `list_models`, filters, gated metadata, expand fields, and inference-provider fields.
3. [Hugging Face CLI reference](https://huggingface.co/docs/huggingface_hub/package_reference/cli) — model discovery filters and expanded metadata.
4. [Hugging Face inference client guide](https://huggingface.co/docs/huggingface_hub/main/guides/inference) — explicit provider selection and automatic provider routing.
5. [LM Studio `lms get`](https://lmstudio.ai/docs/cli/local-models/get) — runtime-compatible search and exact quantization selection.
6. [LM Studio model loading API](https://lmstudio.ai/docs/developer/rest/load) — load-time context and resource controls.
7. [LM Studio basics](https://lmstudio.ai/docs/app/basics) — discovery and local loading flow.
8. [LM Studio system requirements](https://lmstudio.ai/docs/app/system-requirements) — supported desktop systems and baseline requirements.
9. [LM Studio headless mode](https://lmstudio.ai/docs/developer/core/headless) — service operation without the GUI.
10. [LM Studio Python model loading](https://lmstudio.ai/docs/python/manage-models/loading) — programmatic load and unload lifecycle.
11. [LM Studio speculative decoding](https://lmstudio.ai/docs/app/advanced/speculative-decoding) — draft-model compatibility and load implications.
12. [OpenAI Models API](https://platform.openai.com/docs/api-reference/models/list) — model-list response scope.
13. [OpenAI model guide](https://developers.openai.com/api/docs/models) — model-specific capability documentation.
14. [OpenAI design guidelines](https://openai.com/brand/) — official logo download, usage conditions, ownership, and non-endorsement limits.
15. [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list) — available model identities.
16. [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) — model-specific characteristics and identifiers.
17. [Anthropic press kit](https://www.anthropic.com/press-kit) — official Anthropic artwork package.
18. [Gemini Models API](https://ai.google.dev/api/models) — model resources and supported generation methods.
19. [Gemini model guide](https://ai.google.dev/gemini-api/docs/models) — current model and modality documentation.
20. [Google API terms](https://developers.google.com/terms) — API and brand-feature conditions.
21. [Google brand guidance](https://about.google/brand-resource-center/guidance/) — trademark presentation and endorsement constraints.
22. [Official Gemini API logo asset](https://ai.google.dev/_static/googledevai/images/gemini-api-logo.svg) — provider-controlled SVG used by the Google AI developer site.
23. [ElevenLabs Models API](https://elevenlabs.io/docs/api-reference/models/list) — explicit capability flags.
24. [ElevenLabs model guide](https://elevenlabs.io/docs/overview/models) — model families, tasks, and deprecation guidance.
25. [ElevenLabs authentication](https://elevenlabs.io/docs/api-reference/authentication) — server-side secret-key requirements.
26. [ElevenLabs press resources](https://elevenlabs.io/press) — official black and white logo downloads.
27. [Qwen3-TTS 0.6B CustomVoice model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) — exact model ID, runtime example, languages, speakers, license, and hosting status.
28. [Qwen3-TTS repository](https://github.com/QwenLM/Qwen3-TTS) — official installation and inference implementation.
29. [NVIDIA NIM LLM API reference](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html) — deployed model identity, operations, metadata, manifest, and readiness endpoints.
30. [NVIDIA NIM VLM API reference](https://docs.nvidia.com/nim/vision-language-models/latest/api-reference.html) — vision-language operation family and served-model listing.
31. [NVIDIA NIM speech TTS API](https://docs.nvidia.com/nim/speech/latest/reference/api-references/tts/http-tts.html) — TTS-specific operations and metadata.
32. [Cohere model detail API](https://docs.cohere.com/reference/get-model) — compatible endpoints, deprecation, context length, and features.
33. [Civitai current developer reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md) — current REST resources and authentication classes.
34. [Civitai model-version reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/model-versions.md) — version IDs, AIR, base model, and availability.
35. [Civitai authentication guide](https://github.com/civitai/civitai-developer-docs/blob/main/site/guide/authentication.md) — anonymous, mixed, and authenticated behavior including regional filtering.
36. [Cloudflare FLUX.1 Schnell model](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/) — exact model ID, REST example, input/output schema, and per-unit pricing.
37. [Cloudflare Workers AI REST guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) — Account ID, API token, and account-scoped run endpoint.
38. [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — free allocation, tile/step units, and overage pricing.
39. [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) — model-improvement and storage boundaries.
40. [Cloudflare official AI SDK provider](https://github.com/cloudflare/ai/tree/main/packages/workers-ai-provider) — Account ID and API-key configuration for the provider's REST surface.
41. [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/tree/462165984030d82259a11f4367a4eed129e94a7b) — immutable base checkpoint, official offset LoRA, file sizes, hashes, and Open RAIL++ metadata.
42. [FLUX.2 Klein 4B FP8](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/tree/5b4408e59397a4a37ccb46afe426d8ed86379441) — official BFL FP8 diffusion checkpoint and Apache-2.0 metadata.
43. [Comfy FLUX.2 Klein companion assets](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/tree/5f526678002e43af5551dadb73ce2e8c91b43afe) — pinned FP4 text encoder and VAE files.
44. [Comfy Z-Image Turbo assets](https://huggingface.co/Comfy-Org/z_image_turbo/tree/08d04455279082882deaabc8d0d09fc914c071e1) — pinned INT8, FP4, VAE, and excluded BF16 variants.
45. [ComfyUI v0.9.2](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.9.2) — stable runtime release containing FLUX.2 Klein support.
46. [Groq GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b) — production model ID, JSON Schema Mode, limits, and token prices.
47. [Groq structured outputs](https://console.groq.com/docs/structured-outputs) — strict and best-effort model allowlists and schema requirements.
48. [Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03) — exact versioned model ID, Chat Completions, structured output, and price.
49. [Mistral Chat API](https://docs.mistral.ai/api/endpoint/chat) — JSON Schema response format and endpoint contract.
50. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) — request schema and parameter-compatible provider routing.
51. [OpenRouter model metadata](https://openrouter.ai/docs/guides/overview/models) — live `supported_parameters` and per-model price fields.
52. [OpenRouter GLM 5.2 free](https://openrouter.ai/z-ai/glm-5.2:free) — exact model ID, free-route status, and structured-output support.
53. [Z.ai GLM 5.2](https://huggingface.co/zai-org/GLM-5.2) — upstream model identity and MIT license.
54. [Openverse API reference](https://docs.openverse.org/api/reference.html) — anonymous search, query filters, and API operation surface.
55. [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — rights statement used by the strict Openverse result allowlist.
56. [Pexels API documentation](https://www.pexels.com/api/documentation/) — keyed search request, result attribution fields, and API integration requirements.
57. [Pexels license](https://www.pexels.com/license/) — permitted uses and restrictions retained by the stock workflow.
58. [NVIDIA Nemotron 3 Nano Omni 30B A3B Reasoning](https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning) — current hosted visual-language model identity, image-and-text support, JSON support, terms, and free-endpoint availability.
59. [NVIDIA Nemotron Nano 12B V2 VL](https://build.nvidia.com/nvidia/nemotron-nano-12b-v2-vl) — preserved retired identity; the hosted endpoint is marked deprecated and is no longer a selectable route.
