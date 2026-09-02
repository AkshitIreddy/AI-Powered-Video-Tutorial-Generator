# Alystria 2.0 overhaul: model catalogs, creator workflows, onboarding, hardware safety, and AI-assisted editing

**Research date:** 2026-09-02

**Scope:** research and product recommendations only; no implementation claims

**Platform assumption:** Windows desktop, with NVIDIA GPUs as the primary accelerated path and CPU/API fallbacks
**Evidence base:** 46 relevant sources, including official documentation, maintained primary repositories, research papers, production products, and substantive implementation comparisons

## How to read this document

This report deliberately separates evidence from product judgment:

- **Official fact** means the claim comes from a vendor's documentation, brand guidance, maintained primary repository, API reference, or standards body.
- **Primary research** means the claim comes from the originating paper or research implementation.
- **Production observation** means the source describes behavior in a shipping product or a documented production workflow.
- **Product inference** is the recommended Alystria design derived from the evidence. It is not a claim that a source explicitly endorses Alystria's proposed design.

All web sources were accessed on 2026-09-02. Where a source publishes or displays a more specific update date, that date is recorded in the evidence ledger.

## Executive recommendation

Alystria should not reproduce LM Studio as a collection of superficially similar screens. It should adopt the deeper product model that makes catalog-driven creative tools effective:

1. A **federated capability catalog** unifies local models, Hugging Face, Civitai, NVIDIA NIM/NGC, and hosted image providers without pretending they expose identical metadata or licensing.
2. A **compatibility and policy layer** sits between discovery and selection. It evaluates runtime, architecture, base-model family, required companion assets, license, provider availability, VRAM/RAM estimate, and content constraints before a model becomes selectable.
3. A **resource governor** estimates a complete workflow—not just one checkpoint—against live Windows video-memory budget, dedicated VRAM, system RAM, model quantization, resolution, batch size, context/KV cache, and concurrent jobs. Safe defaults must be overridable with explicit consequences.
4. A **replayable setup journey** combines a concise first-run wizard with contextual, game-like teaching panels that highlight real controls and require meaningful actions. It detects already-configured providers and installed runtimes instead of making returning users repeat setup.
5. A **non-destructive creator/editor** exposes generated videos as editable projects: transcript, scene rail, multitrack timeline, canvas, inspector, assets, captions, presenter, slide layers, audio, history, provenance, and export settings. AI proposes reversible operations with previews and diffs; it never silently destructively rewrites a project.
6. Slide generation should offer two explicit modes:
   - **Designed layout:** structured content plus deterministic typography, diagrams, responsive constraints, and an AI visual-review loop.
   - **Illustrated canvas:** generated imagery plus iterative visual critique, masks/inpainting, structural/reference controls, and deterministic text overlays. Generated pixels should not be trusted for authoritative instructional text.
7. Presenter and profile creation should use the same composable generation stack—base model, optional LoRAs, reference/identity adapter, pose or depth control, masked repair, upscale, and provenance—but ship with a curated, diverse, style-balanced starter gallery and clear consent/likeness controls.

The central product principle is **freedom with legible consequences**. Expert users should have granular model and hardware controls, while new users should see compatible recommendations, preflight estimates, plain-language risk states, and a reliable path back to safe defaults.

## 1. Federated model discovery and LM Studio-style catalog UX

### What the evidence establishes

**Official facts:** Hugging Face's `HfApi.list_models` supports free-text search, author, tags/filters, pipeline task, parameter ranges, inference-provider availability, gated state, application compatibility, sorting by creation/downloads/last modification/likes/trending, limits, expanded metadata, model-card data, and configuration fetching. The Hub's model cards supply discovery metadata such as `pipeline_tag`, `library_name`, `base_model`, license, tags, datasets, and evaluation information. Hugging Face explicitly recommends correct metadata and safer `safetensors` serialization.

**Production observation:** LM Studio combines a bundled initial catalog with online requests to Hugging Face for live search, statistics, and downloadable variants. Its download APIs accept catalog identifiers or exact Hugging Face URLs. Its catalog is curated rather than a raw dump of every repository, and its load flow can estimate memory before loading.

**Product inference:** Alystria needs two catalog layers rather than one:

- A **curated Alystria index** for tested combinations, defaults, runtime recipes, known-good quantizations, presentation presets, and editorial workflows. It can ship with the app and refresh as a signed, versioned manifest.
- A **live federated search** for the long tail from Hugging Face, Civitai, NVIDIA, and hosted providers. Live results remain visible, but untested items are labeled and must pass compatibility/policy checks before installation or use.

This avoids the false choice between a tiny safe catalog and an unfiltered, unsafe model dump.

### Recommended catalog information architecture

Use one Model Library surface with persistent scope tabs:

- **Recommended** — Alystria-tested recipes for the detected machine and enabled providers.
- **All sources** — federated search across every enabled catalog.
- **Local** — installed weights, adapters, runtimes, caches, and external model folders.
- **Cloud/API** — available provider endpoints and entitlement state.
- **Updates** — newer revisions, changed licenses, runtime updates, missing dependencies.
- **Collections** — favorites, project-pinned versions, presenter stacks, slide styles, team manifests.

Every result card should show, without opening a detail page:

- provider/source and official status;
- model name, publisher, revision/version, and base-model family;
- capability chips such as LLM, VLM, TTS, ASR, text-to-image, image edit, inpaint, ControlNet, IP-Adapter/reference, LoRA, upscale, lip-sync, video generation;
- local/API state, download size, and estimated installed size;
- measured or estimated VRAM/RAM band for the current configuration;
- format/precision/quantization;
- compatibility state: **Ready**, **Needs components**, **May fit with offload**, **Cloud only**, **Unsupported**, or **Blocked by policy**;
- license summary and commercial-use state: **Allowed**, **Restricted**, **Unknown**, or **Review required**;
- gated/authentication state;
- popularity and recency as secondary evidence, never as a compatibility guarantee;
- safety/provenance signals such as `safetensors`, file hashes, antivirus/pickle scan results, publisher verification, and source URL.

### Search and ranking behavior

Use a normalized query grammar over provider-specific adapters:

`task:image-edit source:huggingface base:flux license:commercial vram:<12GB format:safetensors sort:trending`

The UI should expose this through chips and an advanced query field. Ranking should be transparent and multi-objective:

1. exact task/capability match;
2. compatibility with selected runtime and current hardware;
3. license fit for the project's intended distribution;
4. Alystria validation status;
5. provider availability and account entitlement;
6. quality evidence/evaluations where comparable;
7. recency, downloads, likes, or trending score;
8. estimated latency, storage, and monetary cost.

Popularity cannot outrank a license block or architectural incompatibility. A highly downloaded SDXL LoRA is not usable with an arbitrary FLUX or SD3 pipeline.

### Normalized catalog contract

The catalog should normalize only common concepts and preserve raw source metadata:

```text
CatalogItem
  identity: source, sourceId, publisher, name, revision, immutableHash
  classification: modalities[], tasks[], artifactType, baseFamilies[], architecture
  execution: runtimes[], formats[], precisions[], quantizations[], providers[]
  requirements: diskBytes, estimatedRam, estimatedVram, driver/runtime constraints
  compatibility: requiredArtifacts[], conflicts[], testedRecipes[], confidence
  policy: licenseId, licenseUrl, commercialUse, attribution, derivatives, gated, termsAccepted
  trust: officialPublisher, signatures, hashes, scans, provenance, moderationLevel
  presentation: officialIconRef, previewRefs[], description, tags[], metrics
  sourceMetadata: untouched provider payload and retrieval timestamp
```

Store immutable model/version identifiers in project manifests. Resolve friendly aliases only when browsing; do not silently upgrade a project to a new model revision.

## 2. NVIDIA NIM and NGC discovery

### What is officially available

NVIDIA's API Catalog at `build.nvidia.com` exposes search and exploration by model type or industry, interactive previews, model pages, API references, and hosted endpoints. NVIDIA's current NIM documentation spans language, speech, vision, visual generative AI, video, 3D, safety, and other services. Selected NIMs are downloadable containers, while others are hosted offerings or require NVIDIA AI Enterprise entitlements.

NGC is a related but distinct catalog for models, containers, Helm charts, and SDKs. Its current catalog UI supports keyword search, model/use-case/industry filters, tags, relevance/date/popularity sorting, file browsing, versions, and command-line downloads. NVIDIA warns that API filter enumerations are point-in-time and may change.

### Recommended Alystria integration

Treat NVIDIA as multiple discovery backends behind one provider identity:

- **NVIDIA API Catalog** for hosted trial/API models and their per-model references.
- **NVIDIA NIM manifests** for self-hostable microservices, support matrices, container requirements, endpoint schemas, and entitlement status.
- **NGC Catalog** for versioned containers/models and signed artifact metadata.
- **Locally detected NIM endpoints** for already-running deployments.

Do not infer that every item returned by an OpenAI-compatible `/v1/models` endpoint is deployable, entitled, or suitable for every operation. Catalog availability, API reachability, self-host availability, license/terms acceptance, and successful health probes are separate states.

Each NVIDIA card should therefore show:

- Hosted API / Downloadable NIM / NGC artifact / Local endpoint badges.
- Exact supported operation schema rather than only a generic “AI model” type.
- Entitlement and API-key status.
- Container image/version and supported GPU/driver information when self-hosted.
- “Last verified” time and a lightweight capability probe result.
- NVIDIA-authored license/terms links and any third-party model terms.

For Visual GenAI specifically, build from the operation schema. NVIDIA currently documents text-to-image, image-to-image/editing, text/image-to-video, and 3D generation, with OpenAI-compatible image-generation and image-editing APIs for supported models. Alystria should map those operations into its own capability contract without erasing provider-specific controls.

## 3. Provider icons, brand assets, and licensing

### Evidence and risk

**Official fact:** Hugging Face publishes downloadable brand assets. NVIDIA publishes strict logo guidance: use official assets, preserve proportions/colors/clear space, avoid unofficial fan art, and do not imply endorsement. OpenAI likewise requires accurate use, no modification or false affiliation, and limits use of its marks. Simple Icons is a useful index and its project is CC0, but its disclaimer explicitly says that this does not mean every underlying brand icon is CC0; individual licenses and brand guidelines must still be checked.

**Product inference:** Provider icons need a governed asset registry, not ad hoc SVG copying.

Recommended registry fields:

```text
ProviderBrandAsset
  providerId
  displayName
  assetPath
  assetVariant: full-color | monochrome | wordmark | symbol
  officialSourceUrl
  sourceRetrievedAt
  artworkLicense
  trademarkGuidelinesUrl
  attributionText
  minimumSize
  clearSpaceRule
  allowedBackgrounds
  approvalStatus
  reviewAfter
```

Operational rules:

- Prefer official vendor brand kits.
- Use Simple Icons only as a discovery/fallback source after reviewing its per-icon metadata and the provider's current brand rules.
- Keep icons visually subordinate to Alystria branding and label connections as integrations, not partnerships.
- Never recolor, distort, animate, or combine a provider mark unless its guidance allows it.
- Provide text labels; icons alone are insufficient for accessibility and for similar-looking providers.
- Review marks periodically because brand guidelines and assets change.
- Keep model-license evaluation separate from logo/trademark permission. They are different legal questions.

## 4. Hugging Face and Civitai image-model catalogs

### Hugging Face

Hugging Face offers the broadest cross-modality discovery substrate. Its model-card metadata can identify text-to-image/image-to-image tasks, library/runtime, base model, license, tags, and lineage. The API can filter by task, app/runtime compatibility, provider availability, parameter count, publisher, and other tags. The Hub is valuable for first-party releases, Diffusers pipelines, LoRAs, ControlNets/adapters, upscalers, and quantizations.

However, metadata quality is publisher-dependent. Alystria should assign a confidence score and avoid interpreting missing metadata as permission or compatibility. “License unknown” must remain unknown. A base model inferred from filenames should be displayed as inferred until confirmed by model-card lineage or a known manifest.

### Civitai

Civitai's current developer documentation exposes versioned model, model-version, image, collection, creator, tag, permission, and enum endpoints under `/api/v1`. The model search surface supports name/tag/publisher, model types such as checkpoints, LoRAs and ControlNet, sort/period, base-model and file filters, and commercial/credit/derivative permission filters. Model-version responses include base model, AIR identifier, files, format/precision metadata, hashes, scan results, previews, download URL, moderation state, and statistics.

Civitai is particularly useful for the style/fine-tune long tail, but its ecosystem requires stronger safety and policy handling:

- default to SFW search and previews;
- honor region and browsing-level filtering;
- display creator-defined commercial, derivative, and attribution permissions;
- prefer `safetensors` and successful scan states;
- verify hashes after download;
- quarantine archives/unknown executables and never execute downloaded code automatically;
- pin the AIR/model-version ID and file hash in projects;
- show the required base model and trained trigger words;
- distinguish a model page's popularity from reproducibility or suitability.

### Unified compatibility graph

Model discovery must understand that an image workflow is a graph:

```text
base checkpoint / transformer
  + text encoder(s)
  + VAE
  + scheduler/sampler
  + zero or more LoRAs
  + optional structural control (ControlNet, depth, canny, pose)
  + optional reference/identity adapter (IP-Adapter or architecture equivalent)
  + optional inpaint/edit model
  + optional segmenter/mask tool
  + optional face/detail restoration
  + optional upscaler
```

The UI should reject or clearly warn about incompatible base families, unsupported adapter formats, missing text encoders/VAEs, excessive combined memory, and license conflicts across the graph. A project’s effective license state should conservatively combine every model and asset involved.

## 5. Current image-generation workflow recommendations

### Evidence-backed primitives

- **LoRA:** The originating research freezes base weights and injects low-rank trainable matrices, enabling comparatively small adaptations. Modern Diffusers loaders support architecture-specific LoRA handling for SDXL, SD3, and FLUX. Product implication: LoRA is an adapter layer, not a universal plug-in; compatibility and weight controls must be tied to the base architecture.
- **ControlNet and equivalents:** ControlNet adds spatial conditioning to a pretrained diffusion model; primary implementations support edges, depth, pose, segmentation and related controls. Product implication: users need visible control inputs, preprocessors, strength/start/end controls, and previews—not just prompt text.
- **IP-Adapter/reference conditioning:** IP-Adapter adds image-prompt conditioning and can be combined with structural control. Product implication: separate controls for subject/identity, composition, and style are more predictable than one overloaded reference-image slider.
- **Inpainting/outpainting:** Masked regeneration is the main repair primitive. Product implication: Alystria needs a proper mask editor with feather, expand/contract, invert, semantic selection, and before/after comparison.
- **Upscaling/restoration:** Real-ESRGAN remains a practical maintained restoration/upscaling reference; newer workflow engines also expose specialized upscalers. Product implication: upscale should be a finishing stage with model/purpose choices, tiling, denoise strength, and detail-preservation warnings, not a generic “enhance” button.
- **Modern model families:** Current Diffusers, ComfyUI, Black Forest Labs, and NVIDIA documentation show that SDXL, SD3/3.5, FLUX, Qwen Image/Edit, and newer families coexist. FLUX's official repository separates generation, fill/inpainting, canny, depth, Redux/reference variation, Kontext editing, and LoRA variants. Product implication: capability discovery must be operation-based and versioned; a single “Stable Diffusion model” selector is obsolete.
- **Workflow graphs:** ComfyUI's maintained project demonstrates the value of explicit graphs, reusable subgraphs/templates, partial re-execution, queues, model offload, quantization, and embedding workflow metadata in output media. Product implication: Alystria can expose a friendly form while preserving an inspectable graph underneath.

### Recommended generation experience

Offer three levels of control over the same serialized workflow:

1. **Guided:** intent, style, aspect ratio, reference images, quality/speed, and safe compatible presets.
2. **Advanced:** exact base model, LoRA stack and weights, sampler/scheduler, steps, guidance, seed, control adapters, mask settings, upscale/restoration, precision/offload, provider route.
3. **Graph:** inspect and edit the full execution graph, with typed ports, compatibility checks, cached nodes, and cost/resource estimates.

The generated artifact should preserve:

- prompt and negative prompt;
- model/provider/revision/hash;
- every adapter/control and weight;
- seed, dimensions, sampler, scheduler, steps, guidance;
- input/reference/mask hashes;
- policy/license snapshot;
- generation cost and duration;
- workflow JSON/version;
- post-processing operations.

### Provider strategy

Use one capability interface with provider-specific extension panels:

- **Local Diffusers/ComfyUI:** maximal control, offline operation, user-managed models, complete graphs, and no per-call API cost; requires installation, storage, compatibility management, and hardware preflight.
- **NVIDIA Visual GenAI NIM:** hosted or self-hosted NVIDIA-optimized operations with current support for multiple image/edit/video/3D families and OpenAI-compatible image operations where documented.
- **Black Forest Labs API:** first-party FLUX generation/editing routes; retain the exact endpoint and terms because local FLUX weight licenses differ by variant.
- **Stability AI:** first-party Stable Image generate/edit/control/upscale services through its REST API.
- **fal:** broad catalog with model search, schemas, queues, webhooks, pricing, and many image/video/audio endpoints; useful as an aggregator, but every selected endpoint still needs capability and terms metadata.

Do not flatten every provider to the smallest common denominator. Preserve common controls in the main inspector and place provider-only parameters in an expandable, schema-generated section. Save model/provider choices per task type—writer, visual reviewer, slide illustrator, presenter generator, inpaint, upscale, TTS, lip-sync—so users have the requested freedom to configure each stage independently.

## 6. Two slide-generation schools

### Mode A: designed, programmatic slides

This should remain the default for educational material where text, equations, diagrams, alignment, accessibility, and revision are authoritative.

Recommended multi-pass process:

1. LLM produces a typed lesson/scene specification: objective, narration, facts, labels, semantic units, equation AST/LaTeX, diagram data, hierarchy, and visual intent.
2. Deterministic renderer lays out text and vectors using component constraints, responsive typography, safe areas, alignment rules, and contrast targets.
3. Render low-cost representative frames.
4. A vision-capable reviewer checks overflow, collisions, off-center content, visual hierarchy, legibility, presenter occlusion, repeated content, pacing, and factual correspondence.
5. The reviewer emits bounded structured patches to style/layout tokens or scene data—not arbitrary code.
6. Re-render and compare; require deterministic geometry checks plus visual approval.
7. Preserve every patch and before/after frame in project history.

User controls should include theme, density, font pair, palette, motion level, border/texture treatment, diagram style, presenter placement, safe margins, content emphasis, and per-slide overrides. Provide alignment guides, snapping, distribution, grid/column controls, and a layer inspector so users can fix a slide directly.

### Mode B: illustrated or image-generated slides

Use this for atmospheric title cards, narrative scenes, decorative interludes, visual metaphors, and art-led subjects—not as the default for dense equations or exact instructional copy.

Recommended multi-pass process:

1. LLM creates an art direction brief and a **text-free** composition plan with reserved copy/presenter zones.
2. Generate candidates using a selected model/provider and compatible style/character LoRAs.
3. Apply structure/reference controls for composition and consistency.
4. Vision reviewer scores subject correctness, composition, anatomy, artifacts, empty-space compliance, palette continuity, and consistency with adjacent slides.
5. Repair localized defects with semantic masks and inpainting rather than regenerating the whole slide.
6. Upscale/detail pass with conservative denoise.
7. Add authoritative text, equations, callouts, and accessibility metadata programmatically as editable layers.
8. User can accept, regenerate, mask-repair, restyle, or switch the slide back to designed mode.

This hybrid keeps generated art visually rich while preventing pseudo-text from becoming instructional content.

## 7. Presenter and profile-image creation

### Recommended starter content

Ship 20 presenter presets and 20 profile avatars as complete, curated assets—not incomplete project fixtures. They should cover realistic, editorial illustration, soft 3D, anime-inspired, graphic-novel, flat vector, watercolor, clay, and stylized-cartoon families, while varying age, gender presentation, skin tone, hair, clothing, and accessibility representation. Do not make a race-exclusive catalog the default. If a “white/light tonal” visual treatment is desired, implement it as a background/lighting/art-direction filter rather than equating visual polish with one ethnicity.

Each presenter pack needs:

- portrait/source assets and thumbnails;
- license, consent/likeness provenance, and permitted distribution;
- crop/safe-area variants;
- mouth/face masks or landmarks for the selected animation route;
- voice compatibility metadata without hard-coding gender assumptions;
- sample motion/lip-sync clip;
- tested rendering resolutions and known limitations;
- a complete default project demonstrating the presenter.

### Custom presenter generator

Use the image workflow as a structured recipe:

1. choose style/base model and provider;
2. choose or upload consented references;
3. optionally choose identity/reference adapter and strength;
4. choose pose, framing, wardrobe, background, lighting, and expression;
5. optionally stack compatible LoRAs;
6. generate a contact sheet;
7. let the user select one identity before expensive variations;
8. generate required angles/expressions with fixed identity controls;
9. repair with masks/inpainting;
10. upscale and build presenter metadata;
11. run animation/lip-sync identity checks before accepting the pack.

The app must warn against generating a real person's likeness without rights/consent and should record whether the character is synthetic, user-owned, licensed stock, or based on a real person.

## 8. Windows/NVIDIA hardware safety and resource controls

### What the evidence establishes

Windows exposes an OS-managed video-memory **Budget** and **CurrentUsage** through DXGI. Microsoft warns that exceeding the budget can cause stuttering and performance penalties. NVIDIA NVML exposes dedicated memory, utilization, temperature, power, throttling, and hardware power limits. Changing a GPU power-management limit requires elevated privileges on supported hardware and is not persistent across reboot/driver unload.

LM Studio's shipping UX estimates resources before loading, varies estimates with context length/GPU offload/vision/flash attention, supports automatic GPU offload, TTL auto-unload, KV-cache placement, and multi-GPU selection/allocation. It can limit model weights to dedicated GPU memory while acknowledging that context may still use shared memory. llama.cpp supports quantized weights, CPU+GPU hybrid inference, and quantized KV cache; its documentation illustrates the large storage/RAM reduction from quantization. Diffusers exposes model, sequential, group, and disk offload plus quantization, while warning that aggressive offload can be extremely slow.

### Alystria resource governor

Preflight the **whole scheduled graph**, not a single model:

```text
projected VRAM = resident runtimes
               + model weights on GPU
               + text encoders / VAE / adapters / ControlNets
               + KV cache or diffusion activations
               + attention/workspace overhead
               + renderer/NVENC reserve
               + concurrent-job reserve
               + safety headroom

projected RAM  = CPU-resident weights and caches
               + staging frames/audio/video
               + offloaded layers
               + application baseline
               + OS/user reserve
```

Use both NVML and DXGI because dedicated free VRAM and the Windows budget are not identical. Recompute before each expensive stage and when other processes materially change usage.

Recommended policies:

- **Conservative:** target no more than 70% of the smaller of dedicated-available VRAM and DXGI budget headroom; keep at least 25% system RAM free; one heavy AI job at a time; lower context/resolution/batch first.
- **Balanced (default):** target 80%; keep at least 16 GB or 20% RAM free, whichever is smaller but not below 4 GB; permit one heavy and one light GPU stage if measured fit remains safe.
- **Performance:** target 90%; smaller reserve and more concurrency; explicit warning about desktop responsiveness.
- **Custom:** exact VRAM reserve, RAM reserve, concurrency, power/temperature pause thresholds, offload policy, quantization preference, context cap, image resolution/batch cap, and timeout/TTL.

These percentages are **product inferences**, not vendor-prescribed limits. Calibrate them with telemetry and representative workloads.

### Guardrail behavior

Use a graduated result rather than “works/doesn't work”:

- **Green:** predicted peak fits with reserve.
- **Amber:** fits only with a named adaptation (quantization, CPU offload, lower context, lower resolution, sequential models, smaller batch).
- **Red:** predicted to exceed commit/budget or violate a configured thermal/power policy.
- **Unknown:** missing model metadata; offer a low-cost probe or require manual override.

Before execution, show the estimate and the adaptation plan. During execution, show live VRAM/RAM/temperature/power and the stage that owns them. On pressure:

1. stop accepting new heavy jobs;
2. evict idle models according to TTL/LRU policy;
3. reduce optional concurrency;
4. pause at a stage boundary;
5. offer a resumable fallback configuration;
6. never kill unrelated user processes.

Do not silently modify the physical GPU power limit. Expose an optional expert-only power cap only if supported, clearly explain that it needs elevation and may reset, show the hardware-supported range/default, and require a deliberate confirmation. The safer default is workload scheduling, temperature thresholds, frame-rate/utilization caps, and model offload—not changing board firmware settings.

### Jobs and startup integrity

No job should appear as “running” merely because fixture/demo data or a stale process record exists. Persist an ownership record containing job ID, project ID, creating user action, process ID, boot/session identifier, heartbeat, stage, resource lease, and resumability state. At launch:

- reconcile records against live owned processes;
- mark stale jobs **Interrupted**, never **Running**;
- do not auto-resume unless the user enabled that project/job policy;
- distinguish system maintenance/downloads from project jobs;
- allow “Why is this running?” to show origin, command-free task description, resources, and stop/pause behavior;
- keep background workers console-less and integrated into the app's job center.

## 9. Interactive first-run onboarding

### Evidence synthesis

Microsoft Fluent recommends onboarding that is relevant, non-distracting, optional, benefit-focused, coherent, contextual, progressive, and action-oriented. It specifically recommends welcome/orient/notify/explain/take-action patterns, setup wizards when preliminary actions are required, and replayable just-in-time help. Material's onboarding guidance distinguishes self-selection, quick-start, and top-benefit models and advises giving users a meaningful first action rather than an empty screen. Carbon recommends personalizing from user goals and system-derived state. Game-tutorial research supports contextual, situated, interactive instruction over detached instruction screens. W3C guidance requires correct dialog semantics, focus management, keyboard navigation, escape behavior, and focus restoration.

### Recommended Alystria journey

Use a hybrid of setup wizard and in-product tutorial:

#### Phase 1: welcome and goal selection

- “What do you want to make?”: tutorial, course, explainer, avatar-led lesson, illustrated story, imported-video edit.
- “How do you want to run AI?”: guided automatic, local-first, cloud/API-first, or custom per stage.
- Show a 2–3 minute expectation and allow Skip, Exit, and Replay later.

#### Phase 2: system and privacy scan

- Detect CPU, RAM, NVIDIA GPU(s), dedicated VRAM, DXGI budget, driver/runtime readiness, free disk, model folders, and existing Alystria runtimes.
- Explain what stays local and what each enabled provider receives.
- Recommend an `E:` or other spacious model/cache location when the system drive is constrained, while allowing the user to choose.

#### Phase 3: provider and runtime setup

- Present each capability lane separately: writing/VLM review, image generation/editing, voice, transcription, presenter/lip-sync, video generation, upscale.
- Detect already-configured credentials/runtimes and mark them complete; never ask the user to re-enter a secret merely to replay onboarding.
- Validate keys with the smallest non-billable or clearly disclosed low-cost call available; show scopes and expected charges.
- Offer “Do later” and a working local/API fallback where one exists.

#### Phase 4: model choices and safety profile

- Let the user accept recommended model recipes or open the full catalog.
- Demonstrate hardware estimate changes when context, quantization, resolution, or provider route changes.
- Select Conservative, Balanced, Performance, or Custom resource policy.

#### Phase 5: interactive guided project

Create exactly one complete sample project, not a folder of incomplete fixtures. Use spotlight panels with a dimmed scrim, animated pointer/connector, concise instruction, keyboard shortcut, and progress. Each step points to a real control and waits for a meaningful action:

1. choose or write a topic;
2. inspect the plan;
3. choose duration and models;
4. choose presenter and voice;
5. generate a short draft;
6. open a slide and adjust a layer;
7. use mask/inpaint or regenerate one visual;
8. edit transcript/timeline;
9. preview an AI-suggested change and undo it;
10. run preflight and export.

The tour should branch when a feature is unavailable, stay attached when panels resize/scroll, and never point to a hidden target. Store completion per tutorial version and step, not as one boolean. Help > Guided Tours should replay the full journey or any chapter without erasing configuration or projects.

### Accessibility and resilience

- Use an accessible dialog/popover foundation with focus trapping only when the rest of the interface is truly inert.
- Move focus into each step, announce title/progress, support keyboard navigation, Esc/Skip, reduced motion, high contrast, and 200% zoom.
- Restore focus to the triggering control when the tutorial closes.
- Do not rely on color or pointer animation alone.
- Persist progress after each action and recover if the app restarts.
- Instrument completion, skips, failures, and time-to-first-export without recording keys, prompts, or private media.

React Joyride is a plausible implementation reference because its maintained project advertises React 16.8–19 support, focus trapping, keyboard navigation, and ARIA. Shepherd is powerful and framework-flexible, but its current repository states AGPL-3.0/commercial dual licensing; that needs legal/product review before use in a commercial desktop application. A small internal tour engine built on an accessible positioning/dialog primitive may provide tighter editor integration with less licensing ambiguity.

## 10. Non-linear and AI-assisted video editor UX

### Evidence synthesis

Shipping editors converge on multiple synchronized representations:

- Adobe Premiere combines timeline editing, transcript/text-based editing, media search, captions, speech tools, and scoped generative operations. Its Generative Extend documentation also exposes important limitations, reinforcing that AI capabilities need explicit applicability states.
- DaVinci Resolve 20 documents AI IntelliScript, transcription-driven timeline assembly, smart tools, and a professional multitrack editor rather than replacing the timeline.
- Descript combines document-like transcript editing, scenes, a visual scene editor, and a timeline. Its AI “Quick design” is explicitly a rough cut that users are expected to refine.
- OpenTimelineIO provides a mature, widely deployed model for clips, timing, tracks, transitions, markers, metadata, and adapters while keeping media external.
- ExpressEdit research found value in combining natural language with direct sketch/spatial input rather than asking language alone to express every edit.

### Recommended editor shell

Use one project model with synchronized views:

- **Top:** transport, timecode, undo/redo, version selector, compare, render status, export.
- **Left:** media/project bin, templates, presenters, generated assets, transcripts, markers, history.
- **Center:** video canvas with safe areas, guides, direct manipulation, mask/brush tools, and before/after overlays.
- **Bottom:** multitrack magnetic-capable timeline with video, slides, presenter, titles, captions, narration, music, SFX, and automation/keyframes.
- **Right:** context inspector for transform, crop, style, animation, audio, model recipe, provenance, and policy.
- **Optional transcript panel:** text-based cuts synchronized to source and timeline, with speaker labels and scene boundaries.
- **AI command bar:** natural-language intent plus scope selector (selection, scene, track, range, whole project).

Support professional fundamentals before exotic AI:

- ripple/roll/slip/slide/trim, split, lift/extract, snapping, linked selection;
- nested sequences/compound clips;
- keyframes and easing;
- transitions, masks, blend modes, crop/transform;
- audio gain, fades, ducking, noise cleanup, loudness targets;
- captions and transcript correction;
- proxy/background render/cache management;
- markers, comments, versions, autosave, relink;
- import common media and export presets;
- keyboard mapping and accessible alternatives to drag-only operations.

### AI operation contract

AI should produce an edit proposal, not mutate the timeline invisibly:

```text
EditProposal
  intent
  scope and time range
  assumptions
  ordered operations
  generated/retrieved assets
  cost and resource estimate
  policy/provenance effects
  preview render
  confidence and warnings
  reversible transaction ID
```

The user can Preview, Apply, Apply to copy, Refine, or Reject. Applying creates one undoable transaction and a named project version. Show a human-readable diff such as “removed 3 pauses (4.2 s), replaced slide 2 background, moved presenter right from 00:42–00:57, and normalized narration to −16 LUFS.”

High-value AI tools:

- transcript-based rough cut and filler/silence suggestions;
- script-to-timeline matching;
- scene/pacing analysis;
- semantic media search;
- slide layout critique and bounded auto-fix;
- presenter occlusion and lip-sync/identity checks;
- caption repair/translation;
- music ducking and loudness assistance;
- reframing for aspect ratios;
- object/subject mask tracking;
- localized generative fill/cleanup;
- B-roll suggestions with license/provenance filters;
- continuity checks across slides and presenters;
- export preflight for missing media, clipping, unreadable text, policy, and model-license conflicts.

Keep an internal time/timeline abstraction compatible in spirit with OpenTimelineIO and provide OTIO export/import where adapters preserve the needed semantics. OTIO references media rather than embedding it, which aligns with a non-destructive project manifest. Alystria-specific generative recipes can live in namespaced metadata while standard editorial structure remains interoperable.

## 11. Settings architecture

Settings should be detailed but searchable and layered, not one endless form.

### General

- language, theme, density, reduced motion, scaling;
- startup destination and restore behavior;
- autosave/version retention;
- notification and background-job behavior;
- tutorial replay and contextual-hint controls.

### Storage and cache

- projects, exports, models, generated assets, proxies, render cache, temp;
- per-location free space and writable test;
- size limits, retention, eviction priority, deduplication;
- Hugging Face/Civitai/ComfyUI shared model paths;
- move/verify operation with resume and hash validation.

### Hardware and performance

- detected GPUs, driver/runtime, dedicated VRAM, live Windows budget;
- GPU enable/order and allocation strategy;
- resource policy and custom reserves;
- RAM/VRAM/concurrency/context/resolution/batch limits;
- quantization and offload preferences;
- idle model TTL and job priority;
- temperature/power pause thresholds;
- expert physical power-limit control, disabled by default;
- benchmark and preflight history.

### Providers and credentials

- one card per provider with official icon, status, account/tier where available, capabilities, endpoint/base URL, region, key source, test, quota/cost controls;
- keys stored in the OS credential vault, never rendered in logs or project files;
- per-capability default and fallback chain;
- timeout/retry/rate/concurrency limits;
- privacy and data-retention links.

### Models and workflows

- defaults for writer, visual reviewer, image generation, image edit, presenter, TTS, ASR, lip-sync, upscale, and export QA;
- exact model revision/quantization;
- task presets and compatibility warnings;
- custom model directories and catalog sources;
- auto-update policy and license-change behavior;
- import/export signed model/workflow manifests.

### Generation and editing

- slide mode/theme/density/motion defaults;
- presenter framing, safe areas, voice mapping;
- image recipe defaults, provenance watermark/metadata policy;
- timeline snapping, proxy/render behavior, autosave;
- caption, audio loudness, color and export defaults;
- AI edit proposal strictness and auto-preview policy.

### Privacy, safety, and licensing

- intended distribution default: private, public noncommercial, commercial;
- content and audience controls;
- face/voice consent records;
- telemetry opt-in;
- model and asset attribution report;
- export blockers and override audit trail.

Each advanced setting should show its current value, recommended value, impact, source (user/preset/project/provider), reset action, and whether changing it invalidates caches or requires restart.

## 12. Delivery sequence and acceptance criteria

### Phase 0: integrity before visual expansion

- Eliminate visible consoles; all workers are child processes/services controlled through the integrated job center.
- Reconcile stale jobs on startup and remove incomplete dummy projects/templates.
- Keep one complete tutorial project and meaningful empty states.
- Remove “Studio 1.0” from in-app naming; treat “2.0 overhaul” as release/history language.
- Add a proper Alystria app icon and a governed visual identity without copying the supplied social image.

### Phase 1: visual system and onboarding

- Establish design tokens, typography, spacing, elevation, surfaces, motion, iconography, and rich empty states.
- Replace duplicate template art with distinct, licensed/generated previews that match the template content.
- Ship first-run setup plus replayable contextual chapters.
- Add profile-image and presenter galleries with complete metadata.

### Phase 2: catalogs and resource governor

- Implement normalized catalog adapters for Hugging Face, Civitai, NVIDIA, local folders/runtimes, and initial API providers.
- Add signed curated recipes, compatibility graph, license states, scans/hashes, provider icons, and immutable revision pinning.
- Add Windows/NVIDIA preflight, live resource panel, policy modes, TTL/eviction, and resumable fallbacks.

### Phase 3: slide systems and custom presenter generation

- Complete designed-layout editor and visual-review patch loop.
- Add illustrated-canvas workflow with reference/structure controls, inpainting, upscale, and deterministic text overlay.
- Add custom avatar/presenter workflow with contact sheets, identity controls, consent/provenance, and animation qualification.

### Phase 4: non-linear editor

- Build project/media model, canvas, synchronized transcript/scenes/timeline, inspectors, history and background render/cache.
- Add reversible AI proposal transactions and visual/audio/export QA.
- Add OTIO-based interchange plus common media import/export.

### Minimum acceptance evidence

- First launch from a clean profile completes without a visible terminal or phantom running jobs.
- Replay onboarding preserves configured credentials/runtimes and completed projects.
- Keyboard-only and screen-reader passes cover onboarding, catalog, editor, and dialogs.
- Catalog test corpus demonstrates correct compatibility blocks across base families, adapter types, licenses, gated repos, and provider states.
- Hardware matrix covers at least 4, 6, 8, 12, 16, and 24 GB NVIDIA VRAM with several RAM tiers and confirms safe degradation rather than desktop lockup.
- Every shipped template has unique, representative art and creates a complete project.
- Every default presenter has a sample render, provenance, voice mapping review, and identity-preservation check.
- Designed and illustrated slide modes are compared on the same six-slide lesson, with frame-level review at representative times.
- AI editor operations are previewable, transactional, undoable, and reproducible from project history.
- Export produces a license/provenance report and blocks unresolved commercial-use conflicts.

## 13. Evidence ledger

The ledger records the specific fact used and any limitation. “Updated” reflects the source where available; otherwise the entry records the 2026-09-02 access date.

| # | Source and date | Authority | Evidence used | Limitation / product implication |
|---:|---|---|---|---|
| 1 | [Hugging Face `HfApi` / `list_models`](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api), accessed 2026-09-02 | Official docs | Search/filter/sort fields include author, apps, gated state, inference provider, pipeline tag, parameter range, downloads/likes/trending, expanded card/config data. | API fields can evolve; wrap in a versioned adapter and preserve raw payloads. |
| 2 | [Search the Hugging Face Hub](https://huggingface.co/docs/huggingface_hub/guides/search), accessed 2026-09-02 | Official docs | Programmatic and CLI search support filters, parameter ranges, sorting, and limits. | Search quality depends on model metadata; do not assume completeness. |
| 3 | [Hugging Face Model Cards](https://huggingface.co/docs/hub/model-cards), accessed 2026-09-02 | Official docs | Model cards expose pipeline task, library, base model, license, datasets, tags, intended use and limitations for discovery. | Publisher-authored metadata can be absent or inaccurate; show confidence/source. |
| 4 | [Hugging Face repository licenses](https://huggingface.co/docs/hub/en/repositories-licenses), accessed 2026-09-02 | Official docs | Hub supports standard and custom license identifiers and tells users to respect repository licenses. | A tag is not legal review; custom/unknown licenses require inspection. |
| 5 | [Hugging Face model release checklist](https://huggingface.co/docs/hub/en/model-release-checklist), accessed 2026-09-02 | Official docs | Recommends correct task/library/license/base-model metadata and `safetensors` over pickle. | Applies to publishing guidance; Alystria still needs download verification and policy. |
| 6 | [Hugging Face Model Hub](https://huggingface.co/docs/hub/en/models-the-hub), accessed 2026-09-02 | Official docs | Hub is for model storage, discovery, sharing, library integration, and hosted inference providers. | It is a broad repository, not an Alystria compatibility catalog. |
| 7 | [LM Studio offline behavior](https://lmstudio.ai/docs/app/offline), accessed 2026-09-02 | Official product docs | Discover uses an initial bundled catalog plus network requests to Hugging Face for search/stats/downloads; downloaded models can run offline. | Alystria should disclose online catalog traffic and cache catalog state. |
| 8 | [LM Studio download API](https://lmstudio.ai/docs/developer/rest/download), accessed 2026-09-02 | Official product docs | Download accepts catalog IDs or exact Hugging Face URLs. | Direct URLs need the same compatibility, license, and security checks as search results. |
| 9 | [LM Studio `lms load`](https://lmstudio.ai/docs/cli/local-models/load), accessed 2026-09-02 | Official product docs | Supports context, GPU offload, TTL and estimate-only resource calculation including context, flash attention and vision. | Estimator internals are not specified; Alystria must calibrate its own estimates. |
| 10 | [LM Studio REST model loading](https://lmstudio.ai/docs/developer/rest/load), accessed 2026-09-02 | Official product docs | Exposes context length, batch, flash attention, experts, and KV-cache GPU placement. | These controls are engine-specific; use capability-driven settings. |
| 11 | [LM Studio multi-GPU controls](https://lmstudio.ai/blog/lmstudio-v0.3.14), 2025-03-27 | Official product release | Documents GPU enable/order/allocation and limiting model weights to dedicated VRAM while context may use shared memory. | A dedicated-memory limit is not a complete workflow budget. |
| 12 | [NVIDIA API Catalog quickstart](https://docs.api.nvidia.com/nim/re/docs/api-quickstart), updated 2026-08, accessed 2026-09-02 | Official NVIDIA docs | `build.nvidia.com` supports search by model type/industry, model pages, previews, code, and hosted API keys. | Catalog listing, hosted access, and downloadable NIM availability are distinct states. |
| 13 | [NVIDIA NIM overview](https://docs.api.nvidia.com/nim/docs/introduction), accessed 2026-09-02 | Official NVIDIA docs | NIMs are containerized optimized microservices across language, vision and other use cases with documented APIs. | Vendor performance claims are not Alystria benchmarks; validate on target hardware. |
| 14 | [NGC Catalog User Guide](https://docs.nvidia.com/ngc/latest/ngc-catalog-user-guide.html), updated 2026-08, accessed 2026-09-02 | Official NVIDIA docs | NGC supports model/type/use-case/industry filters, keyword/tag search, sort, versions, signed models, CLI and file downloads. | NGC includes more than NIMs; classify entity type and entitlement. |
| 15 | [NGC API field reference](https://docs.nvidia.com/ngc/latest/ngc-api-field-value-reference.html), updated 2026-07, accessed 2026-09-02 | Official NVIDIA docs | Provides catalog filter enumerations and warns they are point-in-time and subject to change. | Do not hard-code static enum lists indefinitely. |
| 16 | [NVIDIA Visual GenAI NIM overview](https://docs.nvidia.com/nim/visual-genai/latest/overview.html), updated 2026-07, accessed 2026-09-02 | Official NVIDIA docs | Supports image, video and 3D generation/editing operations with optimized NIM runtimes. | Availability varies by model and deployment route. |
| 17 | [NVIDIA Visual GenAI NIM index/API references](https://docs.nvidia.com/nim/visual-genai/latest/index.html), last updated 2026-07-21 | Official NVIDIA docs | Lists current FLUX, SD3.5, Qwen Image/Edit, WAN and OpenAI-compatible image/edit/video references. | Use operation schemas and support matrices, not model-name heuristics. |
| 18 | [Civitai developer API reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/index.md), accessed 2026-09-02 | Official maintained repository | Documents models, versions, images, tags, permissions, pagination/auth/caching and SFW region filtering. | Public API behavior and moderation can change; cache cautiously and handle omissions. |
| 19 | [Civitai model search API](https://github.com/civitai/civitai/wiki/REST-API-Reference/dff336bf9450cb11e80fb5a42327221ce3f09b45), accessed 2026-09-02 | Official repository wiki | Search supports model type, base model, format, sort/period, credit, derivatives, differing licenses and commercial-use filters. | Older wiki revision; prefer current developer docs when fields disagree. |
| 20 | [Civitai model-version reference](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/model-versions.md), accessed 2026-09-02 | Official maintained repository | Version payloads include AIR ID, base model, files, precision/format, hashes, virus/pickle scans, previews and moderation state. | A successful platform scan reduces but does not eliminate supply-chain risk. |
| 21 | [Civitai model-file scanning](https://github.com/civitai/civitai/blob/main/docs/features/model-file-scanning.md), accessed 2026-09-02 | Official maintained repository | Documents ClamAV, pickle import scanning, hashes and safetensors metadata parsing. | Alystria should still verify downloaded hashes and never auto-execute repository code. |
| 22 | [ComfyUI maintained repository](https://github.com/Comfy-Org/ComfyUI), accessed 2026-09-02 | Primary implementation | Demonstrates graph workflows, templates/subgraphs, partial re-execution, queues, API integration, smart VRAM/RAM management, offload, quantization, metadata, broad model support and offline mode. | Custom-node ecosystems add compatibility/security risk; use signed/allowlisted extensions. |
| 23 | [LoRA paper](https://arxiv.org/abs/2106.09685), 2021-06 | Primary research | Freezes base weights and adds low-rank trainable matrices, reducing adaptation size. | Original paper targets language models; image implementations remain architecture-specific. |
| 24 | [Diffusers LoRA loaders](https://huggingface.co/docs/diffusers/api/loaders/lora), accessed 2026-09-02 | Official implementation docs | Provides architecture-specific LoRA loaders including SD3 and FLUX and supports named adapters/weights. | A LoRA cannot be assumed portable across base families. |
| 25 | [ControlNet official repository](https://github.com/lllyasviel/ControlNet), paper 2023; repo accessed 2026-09-02 | Primary paper/implementation | Adds spatial conditions to pretrained diffusion models and supports low-VRAM modes and multiple control types. | Control quality depends on compatible weights, preprocessing and noisy-input handling. |
| 26 | [IP-Adapter paper](https://arxiv.org/abs/2308.06721), 2023-08 | Primary research | Adds lightweight image-prompt conditioning compatible with text prompting. | Identity/style fidelity varies; separate it from structural control. |
| 27 | [Diffusers IP-Adapter guide](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter), accessed 2026-09-02 | Official implementation docs | Documents adapter scaling and combination with ControlNet for structure. | Supported combinations depend on pipeline architecture and adapter checkpoint. |
| 28 | [Diffusers SD3 pipeline](https://huggingface.co/docs/diffusers/main/api/pipelines/stable_diffusion/stable_diffusion_3), accessed 2026-09-02 | Official implementation docs | Documents SD3/3.5 operation, IP-Adapter image prompting, offload and 8-bit paths. | Defaults and quality/memory trade-offs need target-hardware validation. |
| 29 | [Diffusers inpainting](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/inpaint), accessed 2026-09-02 | Official implementation docs | Establishes masked image generation as a first-class pipeline. | User-facing quality depends heavily on mask editing and model choice. |
| 30 | [Diffusers memory optimization](https://huggingface.co/docs/diffusers/optimization/memory), accessed 2026-09-02 | Official implementation docs | Documents device maps, quantization, model/sequential/group/disk offload and speed-memory trade-offs. | Sequential/off-disk paths can be impractically slow; label expected latency. |
| 31 | [Black Forest Labs FLUX repository](https://github.com/black-forest-labs/flux), accessed 2026-09-02 | Official model implementation | Separates Schnell/Dev, Fill, Canny, Depth, Redux, Kontext and LoRA capabilities and licenses. | Variants have different licenses; never inherit one license across the family. |
| 32 | [FLUX.1-dev model card/license](https://huggingface.co/black-forest-labs/FLUX.1-dev), accessed 2026-09-02 | Official model card | Identifies 12B BF16 model, gated access and FLUX Dev noncommercial model license, with separate output provisions. | Product must record exact license revision and distinguish model rights from output rights. |
| 33 | [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN), accessed 2026-09-02 | Primary implementation | Maintained practical image/video restoration and x4/anime model options. | Upscaling can invent/alter detail; expose purpose and denoise/strength controls. |
| 34 | [Stability AI Stable Image API](https://platform.stability.ai/docs/api-reference), accessed 2026-09-02 | Official provider docs | Documents generate/edit parameters and REST endpoints for Stable Image services. | Hosted controls and models can change; generate UI from versioned provider schemas. |
| 35 | [fal model search API](https://fal.ai/docs/platform-apis/v1/models), accessed 2026-09-02 | Official provider docs | Supports list/find/search by text/category/status and optional OpenAPI schema/enterprise-state expansion. | Aggregator availability and third-party model terms must be checked per endpoint. |
| 36 | [Windows DXGI video-memory budget](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/ns-dxgi1_4-dxgi_query_video_memory_info), last updated 2024-02-22 | Official Microsoft API docs | Defines Budget, CurrentUsage, reservation, and warns of penalties above OS budget. | Budget is dynamic and per process/segment; sample continuously and retain headroom. |
| 37 | [NVIDIA NVML field reference](https://docs.nvidia.com/deploy/nvml-api/group__nvmlFieldValueEnums.html), updated 2026-06, accessed 2026-09-02 | Official NVIDIA API docs | Exposes power, utilization, temperature, enforced limits and throttling fields. | Sensor/field support differs by GPU and driver. |
| 38 | [NVIDIA NVML device commands](https://docs.nvidia.com/deploy/nvml-api/group__nvmlDeviceCommands.html), updated 2026-06, accessed 2026-09-02 | Official NVIDIA API docs | Power-limit changes require supported hardware and admin/root and are not persistent by default. | Do not silently change hardware limits; expert opt-in only. |
| 39 | [llama.cpp repository](https://github.com/ggml-org/llama.cpp), accessed 2026-09-02 | Primary implementation | Supports many quantizations, CUDA, CPU+GPU hybrid inference and models larger than VRAM. | Quantization changes quality/speed; model-specific measurement is required. |
| 40 | [llama.cpp quantization memory examples](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md), updated 2026, accessed 2026-09-02 | Primary implementation docs | Shows substantial size/RAM differences between original and Q4/IQ quantizations. | Published examples are not universal estimates for every architecture/context. |
| 41 | [Microsoft Fluent onboarding](https://fluent2.microsoft.design/onboarding), accessed 2026-09-02 | Official design system | Recommends relevant, optional, contextual, benefit-focused, action-oriented onboarding with replayable help and setup flows. | Principles need testing with Alystria's novice/expert audiences. |
| 42 | [Carbon personalized onboarding](https://preview.carbondesignsystem.com/building-experiences/onboard/articles/personalize-your-onboarding-experience), accessed 2026-09-02 | Official design guidance | Recommends user-goal and system-derived personalization, progressive disclosure and adaptive paths. | Behavioral personalization should be privacy-preserving and explainable. |
| 43 | [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), accessed 2026-09-02 | Web standard guidance | Specifies focus movement/trap/restore, keyboard navigation, Escape, labels and modal/inert correctness. | Spotlight tours also need robust target positioning and non-modal alternatives. |
| 44 | [Impact of tutorials on games of varying complexity](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf), CHI 2012 | Primary research | Supports situated/context-sensitive and interactive instruction as a meaningful tutorial design variable. | Older game study; validate transfer to desktop creative software with usability testing. |
| 45 | [Adobe Premiere Generative Extend FAQ](https://helpx.adobe.com/uk/premiere/desktop/edit-projects/edit-with-generative-ai/generative-extend-faq.html), last updated 2026-05-25 | Official production docs | Shows integrated generative timeline operations with explicit media, frame-rate and bit-depth applicability. | Related known-issues docs show AI output may not participate in every downstream feature. |
| 46 | [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO), accessed 2026-09-02 | Maintained production standard/implementation | Mature industry-deployed timeline schema/API for clips, tracks, timing, transitions, markers, metadata and adapters with external media references. | OTIO does not embed media or define Alystria-specific generative recipes; use namespaced metadata and adapters. |

## Additional corroborating sources

These sources informed synthesis but were not needed to reach the 46-item primary ledger:

- [Material Design onboarding](https://m1.material.io/growth-communications/onboarding.html), accessed 2026-09-02 — self-select, quick-start, and top-benefit patterns; meaningful first action and contextual education.
- [React Joyride](https://github.com/gilbarbara/react-joyride), accessed 2026-09-02 — maintained React tour implementation with ARIA, focus trapping, and keyboard support.
- [Shepherd](https://github.com/shipshapecode/shepherd), accessed 2026-09-02 — flexible tours; current repository states AGPL-3.0/commercial dual licensing.
- [DaVinci Resolve 20 New Features Guide](https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf), 2025 — IntelliScript and transcription-driven timeline assembly within a full NLE.
- [Descript Scene Editor](https://help.descript.com/hc/en-us/articles/10165362727821), accessed 2026-09-02 — direct visual manipulation alongside transcript/scenes/timeline.
- [Descript Quick design](https://help.descript.com/hc/en-us/articles/44651483515917), accessed 2026-09-02 — AI creates a rough cut expected to be refined.
- [ExpressEdit](https://arxiv.org/abs/2403.17693), 2024-03 — combines natural language with sketch/spatial input for video editing.
- [Simple Icons disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md), accessed 2026-09-02 — CC0 project status does not grant blanket rights to underlying trademarks.
- [NVIDIA logo and brand guidance](https://www.nvidia.com/en-gb/about-nvidia/legal-info/logo-brand-usage/), accessed 2026-09-02 — official-asset, spacing, color, modification and endorsement restrictions.
- [Hugging Face brand assets](https://huggingface.co/brand), accessed 2026-09-02 — official logo assets and colors.
- [OpenAI design guidelines](https://openai.com/brand/), accessed 2026-09-02 — accurate, unmodified, non-endorsing use of marks.

## Final product position

The overhaul should make Alystria feel less like a thin generation front end and more like a coherent creative operating environment. Its differentiator is not the number of model names in a dropdown. It is the ability to discover almost any relevant model or provider, understand whether it actually fits the task/machine/license, assemble it into a reproducible workflow, learn the product interactively, and refine the result in a serious non-destructive editor.

That design preserves both audiences:

- New users get complete defaults, one excellent starter project, guided setup, safe resource policies, and contextual teaching.
- Expert users get exact model/provider selection per stage, graph-level workflows, quantization/context/offload controls, model hubs, editor precision, provenance, and reversible AI operations.

The implementation should be ambitious in visible craft but conservative in hidden claims: no phantom jobs, no fake completeness, no unverified compatibility, no silent model upgrades, no unexplained licensing, and no AI edit that cannot be previewed and undone.
