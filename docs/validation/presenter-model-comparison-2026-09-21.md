# Presenter model comparison, 2026-09-21

The previous demo's lip-sync and blinking were rejected by the owner. Older
successful test reports are historical evidence, not acceptance of those visuals.

## SoulX-FlashHead Pro candidate

The [official implementation](https://github.com/Soul-AILab/SoulX-FlashHead)
and [model weights](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B)
were pinned to code `9bc03de06bb0de82cd6bc477804512ae06144bf2` and weights
`59119b6c681230c3eeee157e224ae1941746711e`. The managed installation identity
also includes the pinned audio encoder, Python, and CUDA dependencies:
`soulx-9bc03de0+pro-59119b6c+wav2vec-22aad52d+py3106+cu128`.

Private comparison clips reused one eight-second narration with a long silence
around 1.45–2.58 seconds. No premium voice synthesis was used for these probes.
Each output is 512×512 at 25 fps. Review used 5 fps full-face sheets and every-frame
eye/mouth sequences; the featured hosts received an independent second review.
Low background pixel differences alone were not treated as quality proof.

Reference hardware: RTX 4080 Laptop, 12 GB VRAM, 32 GB system RAM. Emma's first
probe took 199.268 seconds, peaked at 8,196 MiB total GPU memory, and used about
11.87 GiB private process memory. These are cold, bounded local measurements;
they are not real-time throughput claims.

| Portrait | Seconds to render 8 seconds | Visual finding |
| --- | ---: | --- |
| Emma | 199.268 | Coherent lips/teeth, visible full blinks, closed long silence, steady background. Some face softening remains. |
| Yuki | 132.866 | Preserved anime linework and one coherent mouth; full blinks, somewhat frequent. |
| Noah | 127.700 | Coherent mouth and visible eye closures; steady workshop background. |
| Chloe | 178.850 | The rejected distorted human-lip patch is absent. Coherent cartoon mouth/blinks; teeth remain stylized and uniform. |
| Maya | 153.961 | Coherent speech, closed long silence, clear blinks and stable surroundings. |
| Finn v2 | 147.962 | Preserved illustrated mouth; dense review confirms a full blink around frames 64–68. |
| Lena | 132.711 | Preserved painted face/mouth and clear natural blinks. |
| Pip v1 | 132.700 | Rejected: mechanical mouth seam and glossy eyes remain static despite head movement. |
| Peaches v1 | 132.665 | Rejected: blinks occur, but mouth does not produce useful speech. |
| Milo | 117.598 | Rejected: speech is visible but invents human-like dental rows inside the cat muzzle. |
| Peaches v2 | 127.505 | Revised portrait preserves a coherent cat mouth, useful speech and full blinks at approximately 5.08 and 7.16 seconds. Quiet mouth can remain thinly parted. |
| Pip v2 | 127.453 | Revised robot mouth now speaks, but dense review of all 200 frames found no full blink. Not qualified. |

These seven human/anime/cartoon portraits prefer the exact reviewed SoulX
revision. This does not qualify arbitrary portraits or animal faces. Additional
animal/robot experiments remain separate until their actual output is reviewed.
Peaches v2 is the first separately reviewed animal source to prefer this runtime;
it does not establish acceptance for other cats or animals.
The reviewed legacy Finn v1 portrait remains hidden from new gallery choices.

## Evidence identities

The private WAV and generated comparison clips are intentionally not bundled or
published. Their artifact hashes allow the local evidence to be identified:

| Clip | SHA-256 |
| --- | --- |
| Emma | `af4197a67029f73a8ceed109b2ef7213f905e5ea8a6a7517b0529fc080d3cf67` |
| Yuki | `2961b3c3309c6d04260d694a5b54b1e05a826c771e417725db03cc74225fe924` |
| Noah | `a158eb0dc67da45bda37a79c69c08430c08f139b12812a59f8d626f2b331a329` |
| Chloe | `92b4724a23474bc6163a63a79929674e8a7abd15f95eeaf2099cb72331cec37d` |
| Maya | `412d687f69d59941781f653b66302175f15cfcd5d22f34460e0b82a4c6a5293e` |
| Finn v2 | `446c5b947a699a3de10197942ad69e9314be2ff838131e2b51dccfbbeb38ffa0` |
| Lena | `ce35b94733764e7b8555951ba2176948c26c453781955255713195e34cc0d8dd` |
| Peaches v2 | `02a5f7d3c78b83fe48b0218d269e94022c400623256ce3240202e6ee98e30039` |
| Pip v2 | `5eab9e1c0ca93a50e2642ec5cd3bad095f7cb6141e70b4711c2d4b74cb47e74c` |

## Rejected alternatives

One isolated [IMTalker](https://github.com/bigai-nlco/IMTalker) Emma probe used
source `bd91867e93c3880db271579c14ef5ccb2e0d404b` and weights
`9e3149b5d8eaa0210406f127a6c77354c7c57d4c`. It rendered eight seconds in
81.859 seconds at 512×512/25 fps, peaking at 3,920 MiB total GPU memory and
approximately 11.8 GB private memory. Mouth anatomy and blinks were coherent,
but opening blur, body reframing and background breathing recreated the owner's
stability complaint. The output remains rejected, SHA-256
`c5f99c4422c5d65a011c6cb593b93d9b3e94080cdd1b78e835e13b950c1235ce`.

An isolated JoyVASA crop experiment aligned Milo and Peaches more accurately and
kept their backgrounds steady, but inserted human teeth/lips. It is not an
accepted animal solution. The official LivePortrait animal path currently
[documents untrained animal retargeting modules](https://github.com/KlingAIResearch/LivePortrait/blob/main/assets/docs/changelog/2024-08-02.md);
using its human eye checkpoint cannot be represented as a generally qualified
animal blink implementation.

## Acceptance boundary

Candidate inference and visual review do not prove the packaged Windows app's
download, activation, project routing, render/export, or capture flow. Those
remain separate integrated acceptance steps. The public demo must use newly
rendered, reviewed narration and actual native app capture; the old demo and
static-portrait draft are not substitutes.
