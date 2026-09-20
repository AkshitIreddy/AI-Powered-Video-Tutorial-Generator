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

These seven human/anime/cartoon portraits prefer the exact reviewed SoulX
revision. This does not qualify arbitrary portraits or animal faces. Additional
animal/robot experiments remain separate until their actual output is reviewed.
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

## Acceptance boundary

Candidate inference and visual review do not prove the packaged Windows app's
download, activation, project routing, render/export, or capture flow. Those
remain separate integrated acceptance steps. The public demo must use newly
rendered, reviewed narration and actual native app capture; the old demo and
static-portrait draft are not substitutes.
