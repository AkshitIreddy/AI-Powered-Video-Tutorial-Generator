# Additional free image API options

Checked on 2026-09-05 against provider-owned documentation. These are research
candidates, not claims that an adapter or account has been tested. No generation
requests, sign-ups, purchases, or account changes were made for this comparison.

| Option | Current free access | Practical decision |
| --- | --- | --- |
| Local SDXL | No hosted inference quota; local hardware and model license apply. | Keep as the verified local option on this 12 GB laptop. Exact recipe and measured outputs are in the local-image audit. |
| Cloudflare Workers AI | 10,000 Neurons daily; the free plan stops when exhausted. Usage varies by model and generation settings. | Keep the existing, live-tested FLUX.1 Schnell adapter as an optional hosted route. The owner's shared allowance is conserved during testing. |
| AI Horde | Community-funded generation is free; anonymous requests are possible at the lowest queue priority. Kudos improve priority. | Worth considering for public slide artwork when variable wait times are acceptable. It is volunteer-operated remote compute, not a private local backend. No adapter or live generation is qualified here. |
| Pollinations | Its current site advertises free Pollen earned through Quests for prototypes and testing. Current API documentation requires an API key. | Candidate for users willing to manage a credit wallet; do not repeat older claims of unlimited anonymous generation or promise a fixed recurring allowance. No adapter or live generation is qualified here. |
| Hugging Face Inference Providers | Free accounts currently receive $0.10 monthly, subject to change. | Useful for a small experiment; too little to describe as generous routine image generation. Provider/model availability must be checked separately. |
| Together AI | General support documentation says there is no free trial and a minimum $5 credit purchase is required. A separate promotional page advertises a $150 credit claim form. | Treat the promotion as conditional until the user's eligibility and awarded credits are confirmed. Do not present it as an automatic or recurring free tier. |
| Gemini 2.5 Flash Image | Its API pricing table lists no free tier for image input/output. | A free Gemini text allowance does not establish free image generation. Do not request a new key on that assumption. |

The app already includes four slide backgrounds and eight reusable elements,
so ordinary tutorial creation does not require image generation. Keep hosted
generation optional and preserve local model downloads as a separate choice.
No additional credential is needed to finish the current native acceptance run.

## Sources

- [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [AI Horde mission](https://aihorde.net/mission/) and [registration](https://aihorde.net/register)
- [Pollinations developer overview](https://pollinations.ai/) and [API documentation](https://gen.pollinations.ai/docs?format=json)
- [Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing)
- [Together free-trial policy](https://support.together.ai/articles/1862638756-changes-to-free-tier-and-billing-july-2025) and [conditional credit promotion](https://www.together.ai/get-credits)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
