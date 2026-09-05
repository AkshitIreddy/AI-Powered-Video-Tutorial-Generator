# Stock media and slide-element audit — 2026-09-05

## Decision

Alystria should keep its existing Openverse and Pexels adapters. Pexels is the practical default for contemporary lesson photography after the user supplies an API key; Openverse is the no-key, open-media route, but automatic selection must be limited to CC0 until the pipeline persists Openverse's exact license version and license URL. The current code stores only a short value such as `by`, which is not enough to render a complete durable CC BY credit.

Do not add Unsplash or Pixabay to the current release. Both are credible sources, but their API operating rules conflict with the current generic download path. Unsplash requires CDN hotlinking, a download-tracking request when a user chooses a photo, and linked attribution. Pixabay permits temporary result hotlinks but requires chosen images to be downloaded, API responses to be cached for 24 hours, and warns against automated/mass queries. Those are product-specific lifecycle contracts rather than another search-request builder.

For history, art, science, and space lessons, the next useful sources are collection-specific and rights-rich: The Met Open Access, Smithsonian Open Access, NASA Images, and Wikimedia Commons. They should remain source-specific candidates until each adapter maps its exact rights fields. Europeana is valuable but requires a key and every selected object's `edm:rights` statement must be evaluated; a search result being present in Europeana is not itself permission to reuse it.

## What exists in the repository

- `services/pipeline/src/alystria/providers/media.py` already implements provider IDs `openverse` and `pexels` for `media.licensed.search`. It builds bounded search requests and converts results to `MediaAsset` records.
- `providers.catalog.json` and the Python catalog already declare both provider IDs.
- `licensed_media_workflow.py` now provides the bounded project workflow around `MediaSearchRequest`. Native command and desktop controls are wired as a separate integration slice so the frozen generation proof is not disturbed mid-run.
- The workflow downloads at most eight candidate rasters through the DNS-pinned safe transport with a 4 MiB per-image limit, validates and sanitizes JPEG/PNG bytes, strips metadata, checks dimensions and pixel limits, makes a separate bounded judge derivative when needed, and persists at most four ranked CAS candidates. The accepted source raster is never replaced by the derivative sent to the VLM.
- `vlm.chat` exists in the provider contract and NVIDIA NIM adapter, but it is not a selectable generation route in the desktop's current route-medium model.
- Openverse is configured without OAuth. Its builder now caps `page_size` at 20 to match the anonymous API limit; a focused regression covers oversized requests.
- Openverse and Pexels searches now carry an exact zero-micro request estimate for `media.licensed.search`. This keeps the desktop's required known-pricing hard-budget gate active while allowing these reviewed no-charge API requests; no other provider capability inherits that estimate.
- Pexels result parsing preserves the photographer name and Pexels landing page, which is enough to render the required review attribution. The review and export surfaces still need to display that credit and link.
- Openverse parsing drops `license_url` and `license_version`. Until those fields exist in durable provenance, only Openverse CC0 results should be eligible for automatic ranking.

## Implemented selection seam

`services/pipeline/src/alystria/providers/licensed_media_selection.py` adds a provider-neutral `LicensedMediaVisionSelector`. It does not duplicate provider search and does not fetch remote URLs from a VLM. `services/pipeline/src/alystria/licensed_media_workflow.py` supplies the surrounding search, download, quarantine, ranking, and project-persistence boundary.

The caller must supply one to eight `PreparedLicensedMediaCandidate` records after retrieval and quarantine. Each record requires:

- an existing Openverse or Pexels `MediaAsset`;
- HTTPS media and source landing-page URLs with no embedded username;
- known dimensions of at least 960×540;
- JPEG or PNG media;
- Openverse CC0, or the Pexels license with creator attribution;
- an inline, already validated JPEG/PNG preview no larger than 4 MiB.

The selector invokes the existing `VisionLanguageRequest` route with a deterministic request fingerprint. It validates a closed JSON result containing lesson-fit, composition, technical-quality, overall scores, a short rationale, and bounded risk flags for every candidate. Watermarks, pseudo-text, logos, unsafe content, irrelevance, or low resolution prevent `readyForReview`. A passing result still returns `reviewRequired: true`; it cannot accept or promote an asset.

The persisted candidate path is now complete through explicit acceptance and asset resolution. Licensed-media candidates are scene-only, retain exact creator/source/license/permission data, and cannot be relabelled as generated media or presenter portraits. Snapshot tampering with origin, source, license, creator, or permissions fails against immutable artifact metadata. The remaining integration boundary is the native command and desktop search/review control. It must supply approved licensed-media and VLM routes and show source, creator, license, and attribution before acceptance.

## Recommended runtime sequence

1. Build two to four search phrases from the scene objective and the user's artwork direction. Do not use the full narration; it creates pseudo-text and generic visual matches.
2. Retrieve no more than 20 Openverse results or 40 Pexels results for one user action. Cache only within each provider's terms and honor rate headers.
3. Apply hard rights filters before any model sees the asset. For Openverse, accept CC0 only with the current schema. For Pexels, preserve photographer, landing page, and Pexels license.
4. Reject unknown dimensions, non-HTTPS URLs, unexpected media types, obvious duplicates, and images below slide resolution.
5. Download bounded candidate rasters through the safe-ingestion boundary. Decode, verify pixels and byte limits, and strip active metadata. Make a separate small judge derivative when a VLM has a tighter input limit; never replace the candidate raster or give the VLM an untrusted remote URL.
6. Judge at most eight previews at a time against lesson intent, literal teaching value, focal clarity, target aspect ratio, negative space, clutter, visible/pseudo text, logos, watermark, and technical quality.
7. Show the ranked candidates with source, creator, exact license, and reason. Keep the accepted scene unchanged until the user chooses one.
8. Accept only the already sanitized CAS candidate after explicit review, persist its source and rights record, and generate an export credit when required. If a future provider requires a second chosen-asset download, implement that provider-specific lifecycle explicitly instead of silently changing this contract.

The selector must not judge copyright, consent, or publicity rights. Those remain hard metadata/policy checks. Faces and brands should be excluded by default for generic explanatory scenes because stock licenses do not remove personality, trademark, or endorsement concerns.

## Source comparison

All pages below were opened and checked on 2026-09-05. "Current" means the page served on that date; provider terms and limits can change and should be rechecked before enabling a new adapter.

| Source | Current operating facts | Alystria decision |
| --- | --- | --- |
| [Openverse API client](https://docs.openverse.org/packages/js/api_client/index.html) | Anonymous use is supported; the client does not implement rate-limit backoff. Queries can filter license and source. | Keep existing adapter. Cap anonymous pages at 20 and honor rate headers/backoff. |
| [Openverse search algorithm](https://docs.openverse.org/api/reference/search_algorithm.html) | Search covers title, description, and tags; license, source, size, aspect ratio, and other filters exist; mature media is excluded by default. | Treat provider rank as retrieval, not final lesson suitability. Keep `mature=false` explicit. |
| [Openverse authentication and throttling](https://docs.openverse.org/api/reference/authentication_and_throttling.html) | Authenticated applications have defined rate-limit tiers. | Add OAuth only if 20-result anonymous searches prove insufficient. |
| [Openverse out-of-terms mitigation](https://make.wordpress.org/openverse/2022/06/17/mitigating-out-of-terms-api-usage/) | Anonymous page sizes above 20 were blocked; scraping and rate-limit circumvention are prohibited. | The anonymous adapter now caps requests at 20. |
| [Pexels API documentation](https://www.pexels.com/api/documentation/) | API key in `Authorization`; maximum 80 per page; default limits 200/hour and 20,000/month; a prominent Pexels link and photographer credit where possible are required for API integrations. | Best current broad-photo route. Surface rate headers and linked attribution in candidate review/export. |
| [Pexels license](https://www.pexels.com/license/) | Free commercial and noncommercial use and modification; no unaltered resale, false endorsement, stock-platform redistribution, or trademark use. | Suitable inside a composed tutorial, with faces/brands conservatively filtered and provenance retained. |
| [Pixabay API documentation](https://pixabay.com/api/docs/) | Keyed API, 100 requests/60 seconds by default, 24-hour response caching, no permanent image hotlinking, and no systematic mass download. | Do not add until provider-specific cache and chosen-image download behavior exist. |
| [Pixabay content license](https://pixabay.com/service/license-summary/) | Free use/modification; no standalone distribution, misleading use, trademark use, or certain uses of recognizable people/brands. | Viable later with hard face/logo/use-context review. |
| [Unsplash API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) | Must use returned hotlinked URLs, call `download_location` on selection, and link attribution to Unsplash and the photographer. | Do not route through the generic downloader. A future adapter needs its own lifecycle and UI credit contract. |
| [Unsplash API documentation](https://unsplash.com/documentation) | Demo mode is 50 requests/hour, production 1,000/hour; supports content filter and orientation. | Strong photos, but integration cost is higher than Pexels for the current product. |
| [Wikimedia Commons API](https://commons.wikimedia.org/wiki/Commons:API/MediaWiki) | `imageinfo` and `iiprop=extmetadata` expose file URLs and license/credit metadata. | Good future open-media source if exact metadata is parsed and normalized. |
| [Wikimedia reuse guidance](https://commons.wikimedia.org/wiki/Commons:REUSE) | Every file has its own license; attribution, license links, share-alike, personality, and other rights can apply; Wikimedia gives no warranty. | Never treat the domain as one blanket license. Preserve and validate each file's license. |
| [Smithsonian Open Access developer tools](https://www.si.edu/openaccess/devtools) | Public API uses an api.data.gov key. Media is provided for public-domain objects; restricted objects may expose CC0 metadata without a media file. | Good future science/history route; accept only records with media and explicit Open Access status. |
| [The Met Collection API](https://metmuseum.github.io/) | No key; limit 80 requests/second; Open Access records expose high-resolution public-domain images and `isPublicDomain`. | High-value future art/history route; require `isPublicDomain=true` and a nonempty image URL. |
| [NASA Images API](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf) | REST search, asset, metadata, caption, and album endpoints. | High-value space/science route after source-specific usage checks. |
| [NASA image/media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) | NASA content is generally usable for educational/informational purposes with NASA acknowledged, but third-party content, logos, endorsement, and identifiable-person restrictions remain. | Never label all NASA results public domain. Store credit and filter third-party/people/logo cases. |
| [Europeana APIs](https://api.europeana.eu/en) | Search and Record APIs expose cultural-heritage media and metadata; a free key is required. | Useful future route for culture/history. |
| [Europeana rights statements](https://pro.europeana.eu/page/available-rights-statements) | Each object carries a machine-readable rights statement; some permit reuse, some restrict it, and some require permission. | Require an explicit open-rights allowlist per record; domain presence is not clearance. |
| [Material Symbols](https://developers.google.com/fonts/docs/material_symbols) | More than 2,500 symbols, Apache-2.0, available as SVG/PNG/font and can be self-hosted. | Best optional broad slide-symbol pack. Pin a repository revision and include Apache notices. |
| [Lucide](https://lucide.dev/) | 1,800+ consistent, customizable SVG icons under ISC. | Keep as the primary lightweight app/slide icon vocabulary; already installed in the desktop. |
| [Heroicons license](https://github.com/tailwindlabs/heroicons/blob/master/LICENSE) | MIT-licensed SVG icon set. | Suitable optional second icon style, though duplicating Lucide has little current value. |
| [Iconify sets](https://icon-sets.iconify.design/) | Aggregates many open-source sets with different licenses, including attribution and share-alike sets. | Do not treat Iconify as one license. If used, persist set ID, icon ID, version, and the originating set's license per asset. |
| [unDraw license](https://undraw.co/license) | Project use is allowed, but compiling/distributing a pack, automated integration/search/download, and AI/ML use are prohibited without permission. | Do not add as an automated asset package or VLM-ranked source. Individual manual user imports remain governed by its license. |

## Verification evidence

- Existing provider request/parse tests cover Openverse license query parameters and Pexels creator/source/license preservation.
- The selector and stock-workflow tests cover quarantined inline VLM inputs, exact provider routing, metadata stripping, bounded persistence, explicit-review behavior, blocking visual risks, strict source/license/dimension gates, immutable provenance, stock-presenter rejection, snapshot-tamper rejection, explicit acceptance, and asset resolution. The focused workflow/selector/acceptance group passed 33 tests.
- A live anonymous Openverse query from this Windows host timed out after 20 seconds with zero bytes on 2026-09-05. That is not an API failure conclusion; it means no fresh network-response proof was obtained from the host, so this audit relies on the official current documentation and repository contract tests.
- A final single-attempt production-policy smoke at 2026-09-05T06:55:55Z used an explicit public-data Openverse route and an independently approved zero-dollar NVIDIA NIM VLM route. The one allowed Openverse request returned HTTP 504 before any image URL was returned. The run stopped without retrying, made zero preview-download and zero VLM calls, and therefore produced no local image. Its credential-sanitized evidence is `E:\temp\Alystria Stock Smoke 2026-09-05\production-openverse-nvidia-20260905-065555\sanitized-stock-smoke-report.json`; a direct secret-value scan reported no credential leak. This is a concrete host/network failure record, not proof that Openverse is generally unavailable.
- The final focused source checks passed Ruff and mypy, and the selector/workflow/candidate/native-control/provider-policy group passed 115 tests under Python 3.12 with Pillow 12.3.0. The large-photo regression proves that a greater-than-180-KiB accepted JPEG stays byte-distinct from its metadata-free, at-most-180-KiB NVIDIA judge derivative.
- The independent real local SDXL candidate proof produced a technically valid accepted 1344×768 PNG but missed the requested binary-search concept and rendered pseudo-text. That result is concrete evidence that a generated or retrieved image still needs content-quality judging and explicit review.
