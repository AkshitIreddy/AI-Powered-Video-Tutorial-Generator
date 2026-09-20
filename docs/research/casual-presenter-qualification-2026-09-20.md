# Casual tutorial presenter qualification

Status: presenter render qualification complete; final native walkthrough pending.
This record separates bundled portraits, measured animation results, and
installed runtime availability.

## Collection

Fourteen current fictional portraits were generated for this project. The
featured order is Emma (realistic woman), Yuki (anime), Noah (realistic man),
and Chloe (cartoon). Maya, Finn v2, Lena, Pip the robot, Milo the cat, Peaches the
kitten, Buddy the dog, Poppy the puppy, Tavi the tiger, and Leo the lion extend
the collection. Clothing and settings are casual tutorial workspaces.

The original 1254 Ãƒâ€” 1254 PNGs, hashes, provenance, and gallery groups are
tracked. Original generation prompts are recorded in
[`casual-presenter-prompts-2026-09-20.json`](../assets/casual-presenter-prompts-2026-09-20.json).
The files retain their embedded C2PA carrier. Static availability does not
establish animation compatibility or install an inference runtime. Finn v1
remains a hidden static legacy asset so existing IDs and bytes are preserved;
it is explicitly rejected for animated speech.

## Why more than one animation engine

The installed LivePortrait Ã¢â€ â€™ MuseTalk route produced usable short samples for
Emma, Yuki, Noah, Chloe, Maya, and Lena. Each used the same accepted 8.219875 s
narration, with no new speech API call. Exact repeated requests recovered the
same promoted video bytes without another inference run.

That route was unsuitable for two other styles: Finn acquired soft,
photorealistic-looking lips against flat anime linework, and Pip failed the
human face crop. Animal portraits must not silently enter that same route.

[JoyVASA](https://github.com/jdh-algo/JoyVASA) generates audio-driven facial
motion for human and animal portraits. Its official Windows reference uses
an 8 GB laptop GPU. This makes it a practical candidate for the owner's
12 GB GPU; actual results, rather than that hardware claim, determine which
portraits are enabled. The source is pinned to
`916a90f8de490e8648fee460c1200bd5d9a795af`.

The square, centered bundled portraits use a detector-free path. The patched
runtime constructs a cropper only when cropping is requested. The selected
path does not load X-Pose or InsightFace detector weights. A staged pack must
exclude those unused restricted models; the research candidate directory is
not a distributable package.

## Corrections found by visual inspection

The first dog result moved the mouth too close to its nose. Inspection found
that the source still selected older animal weights despite the presence of
the official LivePortrait v1.1 weights. Selecting the pinned v1.1 weights
improved the lower-face geometry.

The first audio-driven results also retained lip movement during true
silence. The candidate now uses a measured eight-frame motion offset at
25 fps and an audio RMS envelope on the documented lip keypoints. Eye and
head motion remain independent. This is a correction measured on short
samples, not a claim of universal phoneme-level synchronization.

Initial coarse candidate boards appeared acceptable for eight routes. Dense
inspection of the installed Finn v1 output overturned that verdict: its original
smile remained visible while the shadow beneath it opened as a second mouth.
The original asset therefore cannot qualify. Two targeted image-generation
edits produced Finn v2 with a frontal pose, clear mouth opening, and no separate
chin mark. The v2 strict output animates the actual mouth and closes during
silence while preserving the illustrated style.

Finn v2 uses human motion; Pip, Milo, Peaches, Buddy, Poppy, Tavi, and Leo use
animal v1.1 motion. All eight final routes produce decodable 512 Ãƒâ€” 512,
25 fps H.264/AAC video through the installed strict worker. Each repeated
request recovered the exact promoted bytes without another inference run.

The first installed broker check found two omitted support resources:
`src/utils/resources/lip_array.pkl` and `mask_template.png`. Candidate-folder
tests had masked the omission. The curated installer must include and pin
both before the installed runtime can qualify; successful research-folder
output alone is insufficient. The corrected resource pack rendered all eight
styles, then exposed a second integration defect: intermediate videos were
written inside the delivery directory. The broker's existing exactly-one-file
check rejected those attempts. The adapter now places intermediates in the
declared attempt workspace, and the worker checks that workspace against the
command-line identity before loading model code.

The seven animal/character routes passed sampled mouth placement, nose and
identity stability, and closure during the 2.49Ã¢â‚¬â€œ3.32 second pause. Peak speech
can exaggerate tongues on the animals; Leo has occasional teeth/gum smearing
and Pip has jagged interior highlights. These are visible model limitations,
not claims of photorealistic or every-frame naturalness.

Finn v2 and Buddy also passed an independent eight-second narration from the
previously accepted sky lesson. No speech API was called to create it. Their
actual mouth regions change during speech and close in the sampled 1.46Ã¢â‚¬â€œ2.58
second pause. Both outputs fully decode, and exact request repetition again
recovers identical bytes. This second phrase adds evidence beyond tuning to
the first reference recording, without establishing arbitrary-audio phoneme
accuracy or long-form reliability.

## Runtime integration contract

An optional `portraitRuntimeOverrides` array binds an exact portrait SHA-256
to a child runtime configuration inside the primary configuration directory.
The parent validates the scene's reviewed identity and portrait before
routing. Child configurations are loaded only when selected, cannot nest
overrides, and preserve cancellation and the project's artifact store.

The JoyVASA worker contract pins its adapter, source manifest, audio encoder,
motion generator/template, and portrait-model manifest. The worker verifies
those files before loading model code and installs Python network denial.
This must not be described as operating-system network isolation when the
local test configuration does not provide that guarantee.

The adapter sends raw frames through the broker's explicitly selected H.264
encoder and checks the audio mux result. It does not inherit upstream's
unconditional imageio/libx264 delivery path. Cache identity includes the
runtime fingerprint, portrait, narration, scene, seed, and encoder selection.

## Evidence and limits

The human proof clips live in the portable sandbox's `Presenter Acceptance`
directory, with source hashes, frame boards, receipts, and reuse measurements.
The private handoff records their absolute paths. Those early proof projects
use shortened presenter profile aliases; exact portrait hashes identify the
same bundled files. New probes use canonical product IDs.

Frame boards establish sampled anatomy, identity retention, changing mouth
shapes, and silence handling. They do not establish every-frame quality,
auditory review, arbitrary portrait compatibility, or long-form reliability.
The native walkthrough must identify its four-style comparison as a separate
project using the same short phrase four times, and preserve the completed
sky tutorial as separate evidence.

No Deepgram, Inworld, or Cartesia speech generation was used for these tests.
No application release or package publication is implied by this record.

## Accepted short-sample receipts

All rows reuse the same 8.219875-second accepted narration. Timing is measured
on the owner's RTX 4080 Laptop system and includes worker startup and validation.
The early human reports used temporary short profile aliases; portrait hashes
bind them to the current bundled assets.

| Presenter | Engine | Output SHA-256 | Fresh seconds | Reuse seconds |
| --- | --- | --- | ---: | ---: |
| emma | liveportrait-musetalk-1.5 | `e86b11f911ddb2743d9cf0f94ddde8e807bb7dc686fab23c1e9a7fa6f1e4c84f` | 529.5 | 7.78 |
| yuki | liveportrait-musetalk-1.5 | `c758f3fbb2d32919ac9a7c47311bd3ca44ab20953b0887981f4bf1b481ce942d` | 382.9 | 7.81 |
| noah | liveportrait-musetalk-1.5 | `45487cb1f5868c78ad43ab3ea566f83527292201b70c54380d3b56205b262839` | 398.7 | 7.78 |
| chloe | liveportrait-musetalk-1.5 | `a451cac003cbc7aebaa091dec9ba2691ee9b9b7cb79b36acd2c8e9fa339f89d5` | 397.3 | 7.80 |
| maya | liveportrait-musetalk-1.5 | `a7ff25934c36a6c6995ba63ed2fe5875b2b3b3452a4050f11e31c22087c90906` | 402.0 | 7.73 |
| lena | liveportrait-musetalk-1.5 | `8ab4e6a54bc5463e187229665b907f7791a8969ec4c94fd8bccd207696915a41` | 445.7 | 7.73 |
| pip | joyvasa-animal | `98a544a8c323e38808f4a4f0803a35bb2343ed2e1de97a39c0117ea6118cf4d0` | 49.1 | 1.69 |
| milo | joyvasa-animal | `bb1d0fad6ab4ee28299bcf4840b8689e282d5bbcaadb631bc5a1e62d14d69dbd` | 49.5 | 1.74 |
| peaches | joyvasa-animal | `7026c5edeabbeda0f50284b0c1c5e282e6e8086aee9589bcec68d64d74d5ff08` | 49.8 | 1.67 |
| buddy | joyvasa-animal | `49a4f3b89d675c512da095f08862c12097ce5d2cacc2831dee66ad4656a22553` | 49.8 | 1.72 |
| poppy | joyvasa-animal | `69ee326c630703d4eb72fd8ef21854a9aa285e22e613a0ba846402f5434f3804` | 50.2 | 1.69 |
| tavi | joyvasa-animal | `0f86beada1a1863c642485c03405bbefd005ef9afa94b0faf0fb0fdf1f5cb23b` | 50.4 | 1.72 |
| leo | joyvasa-animal | `666acbe25a9a399e431312e77583e82b1396d030c0e3cd0152bd7f0997324023` | 60.8 | 1.70 |
| finn v2 | joyvasa-human | `c18655bc72628889e763488093c4087bd5d971849bb2c00409df3517c959a52e` | 55.3 | 1.75 |

The final Finn row was rendered through the migrated primary configuration, not
only a candidate override. The final curated runtime manifest is
`240e993925e6faf8a954303334529334e44ddb82e29921c89112f86c0d3f946d`.
The guarded migration replaces only the rejected portrait hash and keeps the
other seven routes and primary configuration fields intact. Animal executable,
source, weight, and child-configuration bytes are unchanged by that migration.
