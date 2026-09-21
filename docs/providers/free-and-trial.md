# Free and trial providers for experimentation

Broad signup table last verified: **2026-08-28**. Selected executable routes were audited again on **2026-09-05**; see the [catalog and provider audit](../research/catalog-audit-2026-09-05.md) and [local image model audit](../research/local-image-model-audit-2026-09-05.md).

For the current app, image generation is optional. Twelve included teaching assets and authored slide geometry work without an image API. SDXL Base 1.0 completed on the 12 GB Windows reference GPU and is an on-demand local option. FLUX.2 Klein FP8 and Z-Image Turbo INT8 remain downloadable candidates requiring hardware verification; their file size alone does not prove VRAM fit.

The [additional image API comparison](../research/free-image-api-options-2026-09-05.md)
checks AI Horde, Pollinations, Hugging Face, Together, Gemini image generation,
and Cloudflare against current official terms. It distinguishes recurring free
access, earned credits, conditional promotions, and paid-only image routes.

The dated September 5 checks succeeded for Groq structured writing and Cloudflare FLUX.1 Schnell image generation. Mistral returned a rate limit, and the then-selected Gemini 2.5 Flash endpoint returned HTTP 404 for the tested account; that result does not describe the current Gemini 3.8 Flash default or 3.7 Flash alternate. The app retains 2.5 only for compatible saved profiles. OpenRouter was not used for generation. These observations do not establish a general provider outage or a guaranteed free quota. Hosted NVIDIA narration and illustration, stock search, and optional rendered-frame review have separate evidence and limitations in the linked audits.

This page is a signup guide, not a promise that an adapter is already shipped.
Provider offers, model access, quotas, data-use terms, and licenses change often.
Check the linked official page again before creating a key or sending project
content. Alystria must also apply the approval, routing, usage-accounting, and
catalog-freshness rules in [Provider and model policy](provider-and-model-policy.md).

## Quick recommendations

For a first end-to-end experiment without entering payment details, the most
useful combination is:

- **NVIDIA NIM, Cohere, Gemini, Groq, or Mistral** for outline/script and structured-text
  experiments.
- **ElevenLabs** for non-commercial voice evaluation, or **Deepgram** for a
  larger one-time speech credit. AssemblyAI is especially useful for alignment
  and transcript QA.
- **Openverse** and **Pexels** for licensed-media discovery. Every selected
  asset still needs provenance and rights checks.
- **Tavily** for live web discovery when Alystria's direct academic adapters are
  not enough.
- **Hugging Face/local models** for private, repeatable work that consumes local
  compute instead of API credit.

Never paste a key into a project file, chat, issue, screenshot, or log. Enter it
through Alystria's credential UI so the value is stored by the operating-system
credential manager. A free quota is not permission to send private sources to a
cloud service.

### NVIDIA NIM: one account for several prototype capabilities

1. Sign in at [build.nvidia.com](https://build.nvidia.com/models) and join the
   free NVIDIA Developer Program when prompted.
2. Open the exact model you want, read its model card/license, confirm that its
   hosted endpoint is currently available to your account, and record the
   displayed rate limit. Do this separately for every model; one key does not
   guarantee every catalog capability.
3. Use **Get API Key** once, then add that value to **Models & providers → NVIDIA
   NIM (dev/test)**. Alystria stores one opaque `nvidia-nim` reference in the OS
   credential vault; do not paste the value into a project or `.env` file.
4. Mark only public or synthetic payloads for this hosted-preview route, accept
   the current Trial Terms, approve the provider-managed region/retention and
   zero-dollar preview budget, and record when model access was checked. Quotas
   and rate limits are separate from financial cost and can still stop a job.
5. Start with a small text or embedding fixture. Image/VLM endpoints
   remain exact-model capability gates; a missing, retired, paid, or changed
   endpoint stops with an error and never silently switches provider.

The 2026-08-28 adapter snapshot uses `openai/gpt-oss-20b` for the audited chat
smoke and `nvidia/nemotron-3-embed-1b` for embeddings. The older
`nvidia/nv-embed-v1` endpoint returned retired status and is blocked. A model
appearing in `/v1/models` is discovery evidence only—not proof that it accepts
chat, embedding, reranking, or visual requests—so Alystria keeps independent
per-capability allowlists.

The reranking request/response contract remains implemented but is dormant by
default because the exact hosted reranker has not been confirmed active for the
account. Video is not advertised: the only typed generation-video endpoint in
this snapshot is a deprecated tombstone retained solely to diagnose old
projects. Neither capability is silently replaced by a different model.

The shared key reduces signup friction, but NVIDIA does not promise that every
model is free or available, and its hosted preview is not a replacement for a
production plan. [Self-hosted NIM microservices](https://www.nvidia.com/en-us/ai-data-science/products/nim-microservices/)
have different infrastructure, licensing/entitlement, privacy, and operating
requirements and must be configured as a separate provider boundary.

LipSync is a separate exception: NVIDIA marks it downloadable and requires the
AI for Media Private Access Program, an NGC Catalog key, a GPU/container stack,
and a gRPC sidecar. It is not unlocked by the ordinary hosted NIM key and does
not provide TTS voices. See the [LipSync model card](https://build.nvidia.com/nvidia/lipsync/modelcard)
and [support matrix](https://docs.nvidia.com/nim/maxine/lipsync/latest/support-matrix.html).

## Recurring free or open access

| Provider | Useful Alystria capability | Current free access | Payment method | Production and rights caveat | Verified |
| --- | --- | --- | --- | --- | --- |
| [NVIDIA NIM API Catalog](https://build.nvidia.com/models) | One Developer API key can prototype selected language/VLM, embedding, reranking, image, and other catalog endpoints | Free NVIDIA-hosted preview access through the Developer Program; the available models and rate limits vary by account/model and must be checked on the selected model page | No payment method is documented in the [API Catalog quickstart](https://docs.api.nvidia.com/nim/docs/api-quickstart) | **Development/testing only, not production. Public or synthetic inputs only in Alystria.** Trial credits/limits can change. The [Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) prohibit production and confidential/sensitive/personal data and permit some content/log collection for improvement, security, and fraud handling. Self-hosted NIM is a separate deployment and entitlement—not a privacy-equivalent use of the hosted preview. | 2026-08-28 |
| [Cohere](https://docs.cohere.com/v2/docs/rate-limits) | Script planning, rewriting, embeddings, and reranking | Free evaluation key; trial chat limits are currently 20 requests/minute and trial keys are capped at 1,000 API calls/month | No payment method is documented for obtaining a trial key | Cohere describes trial keys as testing/proof-of-concept access. Use a production key and current SaaS terms for a public or commercial production workload. | 2026-08-28 |
| [ElevenLabs](https://elevenlabs.io/docs/overview/administration/billing) | TTS, STT, sound effects, and voice-design evaluation | Free plan with 10,000 credits/month; signup starts on the free tier | No billing setup is documented for the Free plan | **Free-plan output is non-commercial and requires attribution.** Commercial rights start on a paid plan; beta output can have additional restrictions. The free plan also does not expose the Voice Library through the API. See the [publishing rules](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform). | 2026-08-28 |
| [Gemini Developer API](https://ai.google.dev/gemini-api/docs/pricing) | Text/multimodal planning, analysis, and selected preview TTS models | Model-dependent recurring free tier; new projects begin on Free and do not need Cloud Billing | No for the Free tier; Paid requires billing and currently at least a $10 prepay for many new accounts | Free-tier prompts and responses may be used to improve Google products. Model availability and free quotas differ; current image-generation and video models are not generally free API options. Review the [billing guide](https://ai.google.dev/gemini-api/docs/billing) and [additional terms](https://ai.google.dev/gemini-api/terms) before sending sources. | 2026-08-28 |
| [GroqCloud](https://console.groq.com/docs/rate-limits) | Fast open-model script/review passes and Whisper transcription | Recurring rate-limited Free plan; exact limits are per model and visible in the account and response headers | No for Free; a valid payment method is required only to upgrade to Developer | Best-effort experimentation, not a throughput or SLA guarantee. Confirm the selected model's license and the current [Groq services agreement](https://console.groq.com/docs/legal/services-agreement) for the intended use. | 2026-08-28 |
| [Mistral Studio](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) | Script generation, OCR/document experiments, embeddings, and moderation | Rate-limited Free mode with API access enabled by default | No credit card required for Free mode | Limits are account/model dependent. `labs-*` models are free but explicitly experimental, silently updateable, not recommended for production, and do not support data-collection opt-out; see the [model lifecycle policy](https://docs.mistral.ai/inference/model-lifecycle). | 2026-08-28 |
| [Openverse](https://docs.openverse.org/packages/js/api_client/index.html) | Discovery of openly licensed images and audio | Open API supports anonymous access and free registered OAuth clients; obey response rate-limit headers | No | Openverse aggregates metadata and does **not** verify that every upstream license claim is correct. Verify the original work, license, creator, attribution, and hosting terms. The [API terms](https://docs.openverse.org/_preview/2205/terms_of_service.html) reserve the right to charge for commercial or heavy usage. | 2026-08-28 |
| [Pexels](https://www.pexels.com/api/documentation/) | Stock photos and video | Free API key; default limits are 200 requests/hour and 20,000/month | No payment method documented; a Pexels account is required | API integrations must link prominently to Pexels and should credit photographers. Pexels media is available for commercial use, but depicted people, brands, trademarks, and third-party works can still require permission; do not imply endorsement or redistribute a stock-library clone. | 2026-08-28 |
| [Tavily](https://docs.tavily.com/documentation/api-credits) | Web search, extraction, crawl/map, and compact research runs | 1,000 API credits every month; endpoint/depth determines credit cost | No credit card required | Search/extraction access is not a license to republish underlying pages. Preserve source URLs and apply Alystria's fetch, citation, and rights policy. | 2026-08-28 |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Hosted open-model text, embeddings, ASR, and image experiments | 10,000 neurons/day on Workers Free; the allocation resets at 00:00 UTC | No for Workers Free; Paid is required for overage and selected frontier models | Model availability and licenses vary, and several resource-intensive models require paid billing even below the nominal free allocation. Treat it as a separate cloud processor, not a local-mode substitute. | 2026-08-28 |
| [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/pricing) | Small hosted smoke tests across model providers | Free users currently receive **$0.10/month** in routed inference credit | No for the included credit; purchased credit is required for excess usage | The hosted allowance is enough for smoke tests, not a tutorial render. Provider pricing and each model's license still apply. Dedicated Inference Endpoints require an active subscription and card. | 2026-08-28 |

## One-time promotional credit

| Provider | Useful Alystria capability | Trial credit | Payment method | Production and rights caveat | Verified |
| --- | --- | --- | --- | --- | --- |
| [AssemblyAI](https://www.assemblyai.com/docs/faq/how-to-get-your-api-key) | Pre-recorded/streaming STT, timestamps, diarization, transcript QA, Speech Understanding, and Guardrails | New accounts receive $50 in credit; the credit does not expire. LLM Gateway is excluded from Free. | No card for Free; add a card and funds to upgrade | A finite evaluation balance, not an always-free allowance. Free accounts have lower concurrency; failed transcripts are not charged. | 2026-08-28 |
| [Deepgram](https://deepgram.com/pricing) | STT, TTS, audio intelligence, and voice-agent prototyping | New accounts receive a $200 promotional credit that does not expire until used | No credit card required | A one-time balance, not a recurring free tier. Calls stop when the balance is exhausted rather than silently converting to pay-as-you-go; current terms still govern output and production use. | 2026-08-28 |

## Free local execution

[Hugging Face local apps](https://huggingface.co/docs/hub/en/local-apps),
`llama.cpp`, Whisper-family runtimes, Kokoro, and other downloadable runtimes do
not consume provider API credit after the files are downloaded. This is the
preferred path for Fully Local projects and repeatable offline fixtures.

"Free to download" does not mean unrestricted. Every model and dataset must be
pinned to an immutable revision, hashed, and checked for license, attribution,
acceptable-use, commercial-use, redistribution, and derivative-output terms.
Hugging Face explicitly tells consumers to find and respect the license of each
repository; see its [license catalog](https://huggingface.co/docs/hub/repositories-licenses)
and [revision-pinned download guide](https://huggingface.co/docs/huggingface_hub/main/guides/download).
Unknown, missing, research-only, or non-commercial licenses must block Alystria's
commercial export gate.

## Useful options that require billing details

These can still be inexpensive test providers, but they are not "no-card free."

| Provider | Included usage | Billing warning | Verified |
| --- | --- | --- | --- |
| [Azure Speech](https://azure.microsoft.com/en-us/pricing/details/speech/) | Always-free F0 allowance currently includes 5 hours/month of real-time STT, 0.5 million neural TTS characters/month, and 5 hours/month of speech translation | A new Azure free account requires a credit/debit card and a possible temporary verification hold. The initial account includes $200 for 30 days; continuing the always-free services after that requires moving to pay-as-you-go, where overage can be billed. See the [Azure account FAQ](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account). | 2026-08-28 |
| [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/pricing/) | Monthly no-charge character bands vary by voice family (for example, up to 4 million characters for Standard voices and 1 million for several neural families) | Cloud Billing must be enabled and overage is charged automatically. This is separate from the Gemini Developer API free tier. New Google Cloud trials require a payment method; the $300 Cloud welcome credit no longer covers Gemini API usage. | 2026-08-28 |

## Commonly confused offers

- **Runway:** the consumer/creative Free plan currently has 125 one-time
  credits, but those are not Runway API credits. The
  [developer API setup](https://docs.dev.runwayml.com/guides/setup/) requires a
  minimum $10 credit purchase before the first API generation.
- **OpenAI and Anthropic:** this guide does not list either as free because no
  generally available, recurring free API tier was confirmed in their official
  developer pricing documentation during this verification pass. Promotional,
  event, education, or partner credits should be treated as account-specific,
  not documented defaults.
- **Google Cloud welcome credit:** as of March 2026, the general $300 Cloud
  trial credit cannot pay for Gemini Developer API or AI Studio usage. Use a
  Free-tier Gemini project or explicitly enable Gemini billing instead.

## README-ready excerpt

```markdown
### Try Alystria with free or trial providers

Alystria is BYOK and does not include hosted AI usage. You can experiment before
paying with Cohere, Gemini, Groq, or Mistral for text; ElevenLabs (non-commercial
Free output), AssemblyAI, or Deepgram for speech; Openverse and Pexels for media
discovery; Tavily for web research; and license-compatible models running
locally from Hugging Face. Offers and terms change, so read the dated
[free/trial provider guide](docs/providers/free-and-trial.md) before creating a
key. Never commit keys, and do not send private sources to a free cloud tier
without reviewing its data-use terms.
```
