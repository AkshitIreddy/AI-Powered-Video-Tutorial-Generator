# Casual tutorial presenter qualification

Status: corrected installed-runtime short samples are reviewed after the owner
rejected background wobble and jitter in the first native walkthrough. Twelve
current portraits have a reviewed animation route; Poppy and Leo are static-only.
Earlier mouth and anatomy reviews do not qualify the superseded JoyVASA clips.
This record separates bundled portraits, measured animation results, and
installed runtime availability.

## Temporal correction — 21 September

The owner's native playback review exposed a defect that the earlier mouth
boards missed. JoyVASA transferred generated rotation, translation, and scale
to the whole portrait. Yuki's torso reached 4.64 pixels of movement in a single
frame at normalized 512-pixel resolution; Chloe reached 4.55. The original
Emma and Noah MuseTalk clips had static backgrounds and torsos.

The corrected adapter holds the source pose, scale, and translation. A centered
filter restrains non-mouth expression without adding lip delay. The encoder
composites the animated face over the original portrait using a feathered region
derived from the source eye and mouth keypoints, including the source tilt.
It preserves the source background, hair outline, and clothing. The measured
background and torso regions in both corrected illustrated-human clips are
pixel-static after decoding; no face-mask ring or cut jaw was visible in the
dense and consecutive-frame review.

The final demo phrase also exposed animal-mouth failures that the earlier
reference narration had not: broad pink muzzle inserts and human-like tooth
bars. Reducing animal articulation from 1.10 to 0.65 removed the rejected broad
patches in the reviewed cat, dog, and tiger comparisons. Animal animation still
has a mildly humanized lip style, and the robot can show a thin bright teeth bar.
Each narration needs a preview; these samples do not establish natural animal
anatomy or phoneme-perfect speech. The lower animal coefficient does not change
the human route.

Dense inspection of the final installed outputs rejected Poppy and Leo even at
0.65: repeated human-like horizontal lip and teeth strips still distort their
muzzles. Their static portraits remain selectable, but both current animation
routes are marked incompatible and blocked even when their runtime is installed.
Twelve of the fourteen current portraits have a reviewed animation route: three
MuseTalk and nine JoyVASA. Pip is accepted only as stylized mechanical speech,
with a conspicuous silver/white mouth highlight; it is not natural mouth anatomy.

Source changes are recorded in local commits `0a0cfe8` and `bf63160`. The current
curated runtime manifest is
`e7ceb413154913c5c58df39e21ff3c1456b516ee55056c60e966477777a83a04`.
Old clips below remain historical evidence and must not replace the corrected
native demonstration.

## Installed correction receipts — 21 September

All rows below were newly rendered through the activated primary configuration
and its hash-pinned child runtime, then recovered byte-identically by an exact
repeat request. No new speech API call was made. Public phrase clips use the
Sulafat audio hash recorded below; the two held-out checks reuse an eight-second
private test narration and are excluded from the public video.
Successful rendering does not mean visual acceptance: Poppy and Leo's receipts
are retained to reproduce the rejected morphology, not to qualify those routes.

Independent held-out Chloe and Milo renders have pixel-static measured background
and torso regions. Dense mouth review and the 1.446–2.579-second pause confirm a
source-like closed mouth through the sustained silence; the long tail also closes.
Chloe retains coherent cartoon shading; Milo's restrained speech retains the stated
stylized-lip limitation. These checks add a second phrase, not long-form or universal
phoneme qualification. The private held-out audio is never included in the README video.

The installer verified curated manifest
`e7ceb413154913c5c58df39e21ff3c1456b516ee55056c60e966477777a83a04`
and adapter `2e18cdb0179c6ebae69aca0e48bd336ec8cac4149617ab5da0e46704e4b11ef6`.
It retained the eleven exact portrait routes and primary config bytes
(`e0048af22637f472230cadde0fcea29673f38ddc8d168d23e729bef2bfceaa71`).
The new child runtime revision, rather than the unchanged parent route paths,
identifies the corrected implementation. Previous installed files were backed up.

| Presenter | Container seconds | Output SHA-256 | Fresh / reuse seconds |
| --- | ---: | --- | ---: |
| yuki | 4.52 | `2288cf9a0f4b80722a6e9d61b71ccf01d402639ba47c5316f64f4a39754b4a02` | 44.72 / 2.03 |
| chloe | 4.52 | `7b40e4f9d9453dd2686eb0bbad1ba67c13dbf30785082fe7eaf0e36a1c38d349` | 44.08 / 1.88 |
| pip | 4.52 | `80b68f32e43b77982747cef9b1a13ae24547475dd8bb37e9e59ae5b140895f37` | 43.61 / 1.92 |
| milo | 4.52 | `83161865a993af83fe34e5c105c25ab8b01cd9138dc61ca481515fdc337395bf` | 49.50 / 1.75 |
| peaches | 4.52 | `f735ddd2404ba4a858a9bd3ee2e1027a3a49280d0c1ad809288687c691870c10` | 49.09 / 1.89 |
| buddy | 4.52 | `0d1a37b042b4a9c073f60f673fe79570174294be5c407918be6c721d27e0da30` | 49.94 / 1.95 |
| poppy | 4.52 | `626feb9ac061c8021300333c75b9f75318f89c5eda6bd06758c8f76e0e533c1c` | 50.31 / 1.84 |
| tavi | 4.52 | `17a46fd528feef1939c228d3980db31950aff971ab519fbeed7977ce0cfda519` | 49.50 / 1.97 |
| leo | 4.52 | `270ca5534f262301fdd2e18a027097770b84a5c5a3c84f8ff328303e21ff84eb` | 49.31 / 1.89 |
| chloe (held-out) | 8.00 | `a6581fc1bbc662f72bc15fbb86618e496df764b57ef2b5197cf14a62b518b1b8` | 67.58 / 1.78 |
| milo (held-out) | 8.00 | `6c5a7fd2c45cd894d535014cc1b2c39a87a9565ff02190e00dde0812e9a39518` | 63.89 / 1.92 |

## Collection

Fourteen current fictional portraits were generated for this project. The
featured order is Emma (realistic woman), Yuki (anime), Noah (realistic man),
and Chloe (cartoon). Maya, Finn v2, Lena, Pip the robot, Milo the cat, Peaches the
kitten, Buddy the dog, Poppy the puppy, Tavi the tiger, and Leo the lion extend
the collection. Clothing and settings are casual tutorial workspaces.

The original 1254 x 1254 PNGs, hashes, provenance, and gallery groups are
tracked. Original generation prompts are recorded in
[`casual-presenter-prompts-2026-09-20.json`](../assets/casual-presenter-prompts-2026-09-20.json).
The files retain their embedded C2PA carrier. Static availability does not
establish animation compatibility or install an inference runtime. Finn v1
remains a hidden static legacy asset so existing IDs and bytes are preserved;
it is explicitly rejected for animated speech.

## Why more than one animation engine

The installed LivePortrait / MuseTalk route produced usable short samples for
Emma, Noah, and Maya. Each used the same accepted 8.219875 s
narration, with no new speech API call. Exact repeated requests recovered the
same promoted video bytes without another inference run.

That route was unsuitable for several illustrated styles: Finn acquired soft,
photorealistic-looking lips against flat anime linework, and Pip failed the
human face crop. Later dense review also rejected Yuki and Lena's earlier
coarse passes: their mouths acquired blurred realistic lips and bright teeth
that did not match the illustrations. Those MuseTalk clips are superseded,
even though they decode correctly. Animal portraits must not silently enter
that same route.

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

Finn v2, Chloe, Yuki, and Lena use human motion; Pip, Milo, Peaches, Buddy, Poppy, Tavi, and Leo use
animal v1.1 motion. These routes produce decodable 512 x 512,
25 fps H.264/AAC video through the installed strict worker. Each repeated
request recovered the exact promoted bytes without another inference run.

The owner also rejected Chloe's original MuseTalk result during the native
walkthrough. Dense review confirmed a detached raised mouth corner beside a
blurred replacement lip/teeth patch, with unstable skin texture. That rejection
supersedes the earlier coarse acceptance and the old MuseTalk proof clip.
The unchanged portrait rendered through JoyVASA's human route instead preserves
one coherent cartoon mouth, moving corners and sharp skin boundaries. Primary
and independent eight-second narration clips close in sampled silence. Teeth
can still look mildly bright or jagged at peak openings, and the original
asymmetric smile becomes rounder during speech. These are bounded observations,
not a claim of every-frame or phoneme-level accuracy.

Yuki and Lena's replacement JoyVASA human clips also preserve one coherent
illustrated mouth, its corners, and the surrounding face texture. Independent
eight-second narration samples close during the 1.47-2.58 second pause and
terminal silence. Their expressions can be broad, and Lena's open-mouth shapes
look more realistic than the closed source drawing. Very short gaps of roughly
64-164 milliseconds do not consistently close the mouth; these are not evidence
of sustained motion during silence. The reviewed route is enabled for these
exact portraits, without promising exact phoneme alignment.

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

The earlier seven animal/character routes passed sampled mouth placement, nose and
identity stability, and closure during the 2.49-3.32 second pause. Peak speech
can exaggerate tongues on the animals; Leo has occasional teeth/gum smearing
and Pip has jagged interior highlights. These are visible model limitations,
not claims of photorealistic or every-frame naturalness. The later demo phrase
overturned acceptance of the stronger animal articulation; use the corrected
qualification above rather than these historical observations.

Finn v2 and Buddy also passed an independent eight-second narration from the
previously accepted sky lesson. No speech API was called to create it. Their
actual mouth regions change during speech and close in the sampled 1.46-2.58
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

## Final demo speech

The README demonstration uses fresh Google Gemini 3.1 Flash TTS preview speech:
Sulafat for Emma, Yuki, Chloe, and the walkthrough narration; Sadaltager for Noah.
Each presenter says "Watch your ideas become clear, engaging lessons."
Independent Groq Whisper transcription matches both source lines exactly, and
all 151 normalized words of the walkthrough narration. Source signal checks
found no clipped samples. These checks establish transcript and signal facts,
not subjective listening quality. Public-safe hashes, scripts, and production
details are in [`demo-audio-provenance.json`](../media/demo-audio-provenance.json).

The earlier hosted NVIDIA trial audio is retained only as private test evidence.
It is not used in the public README demonstration. Routine tests reuse local or
clearly labeled fixture speech; the premium synthesis is reserved for this demo.

Earlier demo renders (video stream duration, with exact repeated-request reuse).
The Yuki and Chloe rows below are superseded after the owner rejected their
background/body motion; Emma and Noah remain temporally stable:

| Presenter | Engine | Video seconds | Output SHA-256 | Fresh / reuse seconds |
| --- | --- | ---: | --- | ---: |
| Emma | LivePortrait / MuseTalk | 4.48 | `80eb90ca696e5be9ed644691114b5d109aad8e3b16dcdfaa797edb96bee8bb6c` | 483.39 / 3.52 |
| Yuki | JoyVASA human | 4.48 | `0895e0b0e7b1ac58932e08166973c5af61c03bc379f2161d2bd27c3e77193c87` | 42.80 / 1.91 |
| Noah | LivePortrait / MuseTalk | 4.76 | `d39f8f2c8cd4d189a9e1a448e45460850a0aa309ed2b8df80207c23a12df672e` | 355.69 / 8.05 |
| Chloe | JoyVASA human | 4.48 | `4832d158fd6948d98d7c520cbc6a0a37c90a35283bbe140233133e343dc6a549` | 40.72 / 1.72 |

These superseded Yuki and Chloe rows used the previous installed configuration. Lena's
additional 4.48-second JoyVASA video is
`64dbf7e420813d58c986785e5b7dfc7f22f20457188609137b2ac8cde11ba096`;
the independent eight-second Yuki and Lena outputs are respectively
`1927e9b093495145da1c7e90ae2154b7cdb5fb1b5e7c3673400281467fa4fc72`
and `2d0f1dc4d8ca7978242faf8be279f6778db9a8719a977cc54ce84548fc8f751f`.
That previous configuration has eleven exact JoyVASA overrides and retains the
original primary default and unrelated settings. Its SHA-256 is
`e0048af22637f472230cadde0fcea29673f38ddc8d168d23e729bef2bfceaa71`.

## Historical anatomy-only receipts

These historical rows reuse the same 8.219875-second reference narration.
They are retained as provenance, not current temporal or animal-mouth acceptance. Timing is measured
on the owner's RTX 4080 Laptop system and includes worker startup and validation.
The early human reports used temporary short profile aliases; portrait hashes
bind them to the current bundled assets.

| Presenter | Engine | Output SHA-256 | Fresh seconds | Reuse seconds |
| --- | --- | --- | ---: | ---: |
| emma | liveportrait-musetalk-1.5 | `e86b11f911ddb2743d9cf0f94ddde8e807bb7dc686fab23c1e9a7fa6f1e4c84f` | 529.5 | 7.78 |
| noah | liveportrait-musetalk-1.5 | `45487cb1f5868c78ad43ab3ea566f83527292201b70c54380d3b56205b262839` | 398.7 | 7.78 |
| chloe | joyvasa-human | `1b87d63b5420419ee154678e7664598ea576bc664b05352978bfcc419736a0bc` | 70.7 | 2.00 |
| maya | liveportrait-musetalk-1.5 | `a7ff25934c36a6c6995ba63ed2fe5875b2b3b3452a4050f11e31c22087c90906` | 402.0 | 7.73 |
| pip | joyvasa-animal | `98a544a8c323e38808f4a4f0803a35bb2343ed2e1de97a39c0117ea6118cf4d0` | 49.1 | 1.69 |
| milo | joyvasa-animal | `bb1d0fad6ab4ee28299bcf4840b8689e282d5bbcaadb631bc5a1e62d14d69dbd` | 49.5 | 1.74 |
| peaches | joyvasa-animal | `7026c5edeabbeda0f50284b0c1c5e282e6e8086aee9589bcec68d64d74d5ff08` | 49.8 | 1.67 |
| buddy | joyvasa-animal | `49a4f3b89d675c512da095f08862c12097ce5d2cacc2831dee66ad4656a22553` | 49.8 | 1.72 |
| poppy | joyvasa-animal | `69ee326c630703d4eb72fd8ef21854a9aa285e22e613a0ba846402f5434f3804` | 50.2 | 1.69 |
| tavi | joyvasa-animal | `0f86beada1a1863c642485c03405bbefd005ef9afa94b0faf0fb0fdf1f5cb23b` | 50.4 | 1.72 |
| leo | joyvasa-animal | `666acbe25a9a399e431312e77583e82b1396d030c0e3cd0152bd7f0997324023` | 60.8 | 1.70 |
| finn v2 | joyvasa-human | `c18655bc72628889e763488093c4087bd5d971849bb2c00409df3517c959a52e` | 55.3 | 1.75 |

The historical Finn row was rendered through the migrated primary configuration, not
only a candidate override. That earlier curated runtime manifest was
`240e993925e6faf8a954303334529334e44ddb82e29921c89112f86c0d3f946d`.
The guarded migration replaces only the rejected portrait hash and keeps the
other seven routes and primary configuration fields intact. Animal executable,
source, weight, and child-configuration bytes are unchanged by that migration.
