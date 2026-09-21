# Background music workflow

Alystria can search Openverse for an optional instrumental music bed from the
Studio **Design → Media** panel. Search never replaces the current soundtrack.
It downloads up to three bounded candidates into the project CAS, shows the
creator, source, license, attribution and duration, and waits for an explicit
**Use** or **Skip** decision.

## Search and rights boundary

- The first query uses a few meaningful words from the tutorial topic. If that
  produces too few eligible tracks, Alystria tries the selected mood and then
  `instrumental`. The durable receipt records every attempted query and the
  query that matched each candidate.
- Only Openverse results labelled CC0 or CC BY are eligible. Results carrying
  noncommercial, no-derivatives, share-alike or unknown terms are rejected.
- The selected track keeps its exact creator, source page, license URL,
  attribution text, content hash and upstream identity in project provenance.
- Openverse aggregates third-party metadata. The review panel therefore links
  both the source and license and asks the publisher to confirm the source page
  before publishing. Selection records that human review; it does not claim
  that Openverse independently verified the rights.
- Uploading owned or separately licensed WAV, MP3, FLAC, Ogg or Opus audio
  remains available when online search is unsuitable.

Openverse documents that general queries search titles, descriptions and tags,
and that audio search supports license and length filters. See the
[Openverse search documentation](https://docs.openverse.org/api/reference/search_algorithm.html).
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits sharing and
adaptation, including commercially, when the user supplies appropriate credit,
a license link and a change notice. [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
waives copyright restrictions to the stated extent, while warning that other
rights and the lack of warranties still matter.

## Mix and export behavior

Accepting a candidate creates a promoted music asset and selects it in the
portable canvas customization. The editor places it on the music track for the
full timeline. Export loops a short source to the timeline length, converts the
Music under narration percentage to decibels, and applies the requested ducking
only inside authored narration time windows. The export receipt and final media
artifact retain the hash-bound credit record, and a sibling
`*.credits.json` sidecar carries the title, creator, license, attribution,
source URL and SHA-256 for licensed assets used by the timeline. Music stays
optional and off when no asset is selected.

The focused tests cover search fallback and receipts, rights filtering, CAS
tamper rejection, durable worker execution, acceptance and rejection, editor
binding, manifest emission, FFmpeg looping, and measured gain reduction during
a narration window.
