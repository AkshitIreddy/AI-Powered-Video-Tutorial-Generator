# Optional Gemini image review

The image-review profile can select Gemini 3.7 Flash alongside the existing
NVIDIA route. Openverse still needs no search credential, while Gemini review
requires the user's Gemini vault key and explicit project-routing approval.
Candidates remain quarantined previews until the user accepts them.

The adapter uses the documented
[inline image input](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding)
on the exact
[Gemini 3.7 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash).
It does not fetch arbitrary image URLs or upload project files to the Files API.
Requests are limited to eight verified PNG/JPEG previews, each at most 2048px
per edge and 4 MiB, with at most 16 MiB of combined base64 data and 8192 output
tokens. Invalid bytes, MIME mismatches, and supplied digest mismatches are
rejected before egress. Google API-key headers are redacted in diagnostic views.

Google lists a free tier, subject to account and regional eligibility. The
budget check never assumes free quota. It conservatively uses the published
post-promotion standard ceiling of $1.50 per million input tokens and $7.50
per million output tokens, including thoughts, plus a bounded image allowance.
See [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
The catalog links the free-service data terms for review before content approval.

## Evidence and limitation

The combined provider/vision/runtime selection passed 70 tests. The frontend
routing/catalog selection passed 28 tests and TypeScript checking passed.
A policy containing only Gemini vision (without a Gemini writing route) is
covered through the real runtime factory and injectable transport.

One real network attempt on September 8 sent only a synthetic red 32x32 image,
with a 256-token output limit and a 50,000-micro-dollar budget ceiling. The
adapter returned `TRANSIENT` after approximately 67 seconds. No retry was sent.
Receipt: `E:\temp\avt-final-media-inspection-20260907\gemini-vision-one-call-20260908.json`.
This is an implemented, locally tested integration with **unverified live
semantic output**, not a successful hosted review. No private project content
or restricted TTS provider was used.
