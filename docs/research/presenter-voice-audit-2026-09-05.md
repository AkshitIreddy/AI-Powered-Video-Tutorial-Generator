# Presenter, voice, and alignment audit — 2026-09-05

## Scope and evidence standard

This audit independently rechecks the presenter decision in
`presenter-motion-runtime-2026-09-04.md`, the current pipeline boundary, the
preserved v1 implementation, the `v1.0.0` tag, current documentation, and the
available local runtime. Repository history and prior benchmark files are
evidence, not authority. A model is called *available* only when its official
source is public and its conditions are compatible with this Windows product;
a model is called *verified here* only after a fresh local run.

The legacy v1 path used Edge TTS and SadTalker after a Cohere-generated script.
That path is useful as a product-history baseline, but it is not a quality or
provenance baseline for the current application.

## Decision

Keep **LivePortrait → MuseTalk 1.5** as the installed local presenter profile
for this 12 GB Windows machine, with three qualifications:

1. It is an **offline/test profile**, not the only or best theoretical
   presenter. The current runtime config still declares `unsafe-test-only` and
   `networkPolicy: not-enforced`.
2. It is far from interactive. The fresh uncorrected-batch 9.6-second hybrid run
   below took 479.257 seconds wall time. Restoring MuseTalk's upstream batch of
   eight reduced the identical repaired mouth pass from 327.751 to 280.850
   seconds, but fixed portrait preprocessing still dominates short jobs.
3. MuseTalk must restore source frames during true narration silence. The fresh
   uncorrected run visibly opened the mouth during a deliberately silent lead;
   this audit repairs that adapter seam.

The prior hybrid choice survives because it is the strongest *installed and
demonstrated practical* route, not because two stages are intrinsically better.
LivePortrait preserves the source identity and supplies local head, eye, blink,
expression, and shoulder motion. MuseTalk supplies speech motion without the
identity drift observed in the local LongCat Avatar 1.5 specimen. Recent
full-generation avatar systems remain a poor default for this machine because
their official paths require H100-class hardware, 24 GB or more VRAM, Linux,
very large checkpoints, or do not publish a runnable model.

Two optional local challengers should be evaluated in a separate, pinned pack:

- **JoyVASA** is the most practical motion-stage challenger. Its official
  Windows instructions were tested on an RTX 4060 laptop with 8 GB VRAM, and
  it drives expression and head motion from audio rather than replaying one
  fixed motion template. It is not installed or benchmarked in this audit.
- **LatentSync 1.6** is the strongest maintained lip-only challenger. Its June
  2025 release added 512×512 inference and blur improvements. It should be
  compared with MuseTalk on identity, silence rest, temporal stability, speed,
  and license/distribution conditions. It is not installed or benchmarked
  here.

Do not replace the installed route with LongCat, Hallo3, EchoMimic V3,
HunyuanVideo-Avatar, InfiniteTalk, or OmniHuman on demo quality alone. The
local LongCat result changes eye colour and face shape. Hallo3's official path
is Linux/H100/English-only. Other diffusion systems have materially higher
memory or runtime requirements, and OmniHuman does not publish model downloads
or a service.

## Fresh Windows evidence

### Integrated hybrid run

- Date: 2026-09-05.
- Input portrait:
  `apps/desktop/src/assets/presenters/academic-amara-v1.webp`, SHA-256
  `97067bcbeea43e043089692aa3b920ac5bd77cdd9cdb21b78ddc1f50af5221b5`.
- Narration: Windows stock speech padded with 0.75 seconds of digital silence at
  both ends; SHA-256
  `2e0d249a6cc1ab252e8e6486b509903bb86c3cb6bdd02df88b70b2cbb6b8f3fb`.
- Runtime:
  `E:\temp\AI Video Tutorial Generator Test Sandbox\Models\presenter-runtime.json`.
- Result:
  `E:\temp\avt-presenter-bench-2026-09-05\hybrid-silence-aware-20260905-093954\presenter-identity-and-motion-check.mp4`.
- Output SHA-256:
  `dcb063d92c4943adfa9637733fc21f9b1c97a894bfe8030168969219084371ee`.
- Wall time: 479.257 seconds for 9.600 seconds of 640×640, 25 fps output.
- Streams: H.264 video 9.600 seconds; mono AAC 22.05 kHz audio 9.566621
  seconds; delta 0.033379 seconds.
- Encoder: NVENC probe failed with driver/API incompatibility; the policy
  selected H.264 QSV and recorded that fallback.
- Visual result: identity, brown eye colour, face shape, background, and jacket
  remain stable; the motion clip supplies two clear blinks and subtle pose
  movement. Mouth shapes vary with speech, but the first two sampled frames
  show an open/talking mouth during the deliberately silent lead.
- Contact evidence:
  `E:\temp\avt-presenter-bench-2026-09-05\hybrid-silence-aware-20260905-093954\contact-2fps.png`
  and `mouth-strip-2fps.png`.
- Isolation evidence: the same timestamps in the fresh LivePortrait intermediate
  keep the mouth closed, locating the silent-mouth defect in the MuseTalk pass:
  `project\staging\presenter\attempt-1ce56fa068804241987f25af5e3855b6\workspace\liveportrait-results\liveportrait-mouth-2fps.png`.

The inspected `hybrid-output-v2/blink-sequence.png` is an older Maya specimen,
not fresh Amara evidence. The 2026-09-04 contact sheets remain useful historical
comparators but are not relabelled as outputs of this run.

### Repair verification

The repaired MuseTalk adapter decodes the final narration to pinned, mono 16 kHz
PCM, computes a 25 fps energy envelope, and blends generated frames back to the
verified source during true silence with a two-frame transition. This directly
addresses the observed failure without changing speech frames or the source CAS
object. The installed test pack was updated with the repaired adapter's exact
SHA-256 pin; its pre-change adapter and config were preserved beside the pack.

- Replay adapter SHA-256:
  `bddf0bd6c1a3d02884e4d6808480d1eaff895ea56b29b44890e7ee1da9116082`.
  Subsequent source changes sorted the import block and restored the pinned
  upstream inference batch of eight. The current repository and staged runtime
  pin is
  `0624235f6716fd3f22f23e2efde4d564d9a18677df22b8b076d702a1e409f006`;
  the recomputed worker-contract install fingerprint is
  `33e6563459c426ef1d1fe34e5ba1462664ab58ed44ddb73f6bf95265a29b58c5`.
- Discriminating replay: the repaired MuseTalk stage consumed the fresh
  LivePortrait intermediate and the same silence-padded narration. Reusing the
  fresh motion output avoided an unchanged second LivePortrait pass.
- Result:
  `E:\temp\avt-presenter-bench-2026-09-05\musetalk-silence-repair-20260905-095654\presenter-identity-and-motion-check.mp4`.
- Result SHA-256:
  `5ac86330c84bacc45f13c2bf61e89f57dfc1ccb65cc08d2a1f303b469c4c62f8`.
- Wall time: 327.751 seconds for the repaired MuseTalk stage.
- Stream validation: video 9.600 seconds, audio 9.566621 seconds, delta
  0.033379 seconds; the strengthened stream-duration contract accepted it.
- Visual verification: both sampled frames in the 0.75-second silent lead now
  retain the closed LivePortrait mouth, speech frames retain generated mouth
  shapes, and the silent tail returns to the source mouth. Evidence:
  `contact-2fps.png` and `mouth-strip-2fps.png` beside the repaired result.

### Throughput correction

The adapter had overridden MuseTalk 1.5's official inference default of eight
with `batch_size=1`. A second replay used the same fresh LivePortrait clip,
audio, silence repair, and encoder policy with batch eight:

- Result:
  `E:\temp\avt-presenter-bench-2026-09-05\musetalk-silence-batch8-20260905-101501\presenter-identity-and-motion-check.mp4`.
- Result SHA-256:
  `4737330d15695eb84b2a15767b9d21115023be15b58193f37edb51bee2ddef3a`.
- Wall time: 280.850 seconds, 46.901 seconds faster than the identical batch-one
  mouth pass.
- Visual result: leading and trailing silence remain closed, speech shapes and
  blink/pose motion remain intact; contact evidence sits beside the result.

The paired timings imply approximately 274 seconds of fixed model and portrait
preprocessing and approximately 6.7 seconds of variable 9.6-second inference at
batch eight if batch scaling is close to ideal. Launching one worker per scene
would repay the fixed cost for every scene. A future presenter-throughout mode
should therefore generate one continuous presenter from the final narration and
slice it at exact scene audio boundaries with pinned FFmpeg. That continuous
mode is not the current final-proof scope and must not be claimed as integrated.

The presenter output validator now probes individual stream durations. It
rejects a file whose video and audio differ by more than three frames (at least
120 ms), or whose container duration disagrees with its streams. Previously a
1-second video plus 4-second audio could pass if the container metadata looked
plausible.

Unit/integration boundary checks: 21 passed and 1
skipped because NumPy is absent from the lightweight pipeline test environment;
the runtime environment used by the real adapter includes NumPy and OpenCV.

### Final native-proof profile

The representative native proof uses the existing fictional
`presenter-portrait.broadcast-elena-v1` catalogue portrait with NVIDIA Magpie
`Magpie-Multilingual.EN-US.Aria`. Presenter video is intentionally limited to
one sparse opening scene; the rest of the roughly three-minute lesson uses
authored slides. This is an explicit product choice for the proof, not evidence
of a continuous three-minute presenter workflow.

- Portrait: `apps/desktop/src/assets/presenters/broadcast-elena-v1.webp`
- Portrait SHA-256:
  `fcc738597b65c6e19b2a4c7aebf672cf1b911079db9a8c86f46e3689ad038be4`
- Installed profile ID: `presenter-portrait.broadcast-elena-v1`
- Runtime config:
  `E:\temp\AI Video Tutorial Generator Test Sandbox\Models\presenter-runtime.json`
- Runtime-config SHA-256:
  `0b1bf11a4f927eeaf9fe0ce5439d438a880074a23f25ecc9c1360766494a622a`
- Preflight evidence:
  `E:\temp\AI Video Tutorial Generator Test Sandbox\Models\Presenter\evidence\elena-runtime-preflight-20260905-114545.json`
- Preflight result: profile-to-CAS binding true; every pinned file hash passed;
  worker contract `alystria.musetalk.worker.v1`; install fingerprint
  `d27a9da27e2c46a70f6ed215effce7173204f3eb3532e29090539704d12f56e9`.
- Encoder selection: H.264 QSV. NVENC was rejected by the driver/API probe and
  is not claimed.

This was a metadata, file-integrity, and worker-contract preflight. It did not
synthesize extra speech or presenter video and did not load the GPU. The final
native generation result is recorded by the Windows integration lane.

## Voice route

Use a quality ladder instead of presenting every engine as equivalent:

1. **NVIDIA Magpie TTS Multilingual** is the preferred hosted narration route.
   NVIDIA's current NIM exposes HTTP and gRPC synthesis, twelve languages
   including Hindi, built-in voices and selected emotional styles. Query the
   live voice catalog and persist the exact returned voice ID. For the selected
   fictional Elena presenter, use the female English voice
   `Magpie-Multilingual.EN-US.Aria`, which NVIDIA uses in its current official
   HTTP, gRPC, and deployment examples. The male
   `Magpie-Multilingual.EN-US.Jason` belongs with a deliberately selected male
   presenter; it is not an honest default pairing for Elena. The downloadable
   NIM's smallest published profile needs 12.58 GiB GPU memory and explicitly
   does not support WSL, so it does not fit this 12 GB Windows machine as the
   default local pack. Use the authorized hosted NIM route unless a compatible
   machine is provisioned. Magpie Zeroshot is restricted-access and needs 13.06
   GB for its smallest published profile.
2. **ElevenLabs Multilingual v2** is the stable cloud choice for long-form
   narration; **Eleven v3** is the expressive cloud choice when direction and
   emotional range matter. When the provider returns character alignment, keep
   it as the highest-confidence timing source. The timestamp endpoint exposes
   both raw and normalized character alignment. Zero-retention mode is an
   enterprise condition and must not be implied for ordinary accounts.
3. **Qwen3-TTS** is the strongest current local custom-voice family for its ten
   published languages, with 0.6B and 1.7B 12 Hz variants and streaming support.
   The current app catalog's `Qwen/Qwen3-TTS-0.6B` identifier and `onnx-runtime`
   claim do not match the official current release. Use an exact current
   `Qwen3-TTS-12Hz-0.6B-CustomVoice` or `Base` pack only after pinning and local
   verification. Hindi is not one of the ten documented languages.
4. **Chatterbox v3** is the better local multilingual candidate when Hindi is
   required. The official v3 release describes a 0.5B model, 23+ languages,
   reduced hallucination, and built-in watermarking. Its upstream path is
   Linux-tested; Windows packaging remains to be proved here.
5. **CosyVoice 3** is a capable multilingual research candidate, but it needs a
   separately pinned runtime and product-license review.
6. **Windows/System.Speech** remains a deterministic offline draft and recovery
   voice. It should not be labelled the quality default.

F5-TTS and Wav2Lip cannot be default product dependencies without resolving
their published non-commercial model conditions. A permissive code repository
does not automatically make all weights, datasets, voices, or generated assets
safe to redistribute. Deepgram, Inworld, and Cartesia credentials are reserved
for other work and were not used by this audit or its benchmark narration.

## Alignment route

Timing confidence should follow the origin of the timing data:

1. Provider-native character, word, speech-mark, or viseme timings when the
   selected TTS engine emits them. Azure's Speech SDK can emit 22 viseme IDs and
   audio offsets; SVG output is limited to `en-US`, while blend-shape output is
   60 fps. AWS Polly speech marks and ElevenLabs character alignment should be
   retained rather than regenerated.
2. Known-transcript forced alignment. Montreal Forced Aligner is the precise
   route when a matching acoustic model and pronunciation dictionary exist.
   ElevenLabs Forced Alignment is a managed 29-language option. WhisperX is a
   broad local fallback using wav2vec2 alignment and VAD, but its current CUDA
   requirement, language-specific models, and token limitations must be
   surfaced.
3. Duration-proportional timings are estimates. They must report estimated or
   partial status and must never claim `COMPLETE` with a 1.0 aligned-token ratio.
   Count equality alone is not transcript identity.

WhisperX should be pinned at a revision containing the 3.7.8 timestamp fixes or
later. Its own documentation notes that some tokens such as digits and currency
symbols cannot be aligned, and issue reports demonstrate multi-second number
errors. Normalize narration text consistently before alignment, compare token
identity as well as count, and retain unresolved-token diagnostics.

## Primary-source ledger

All pages below were opened on 2026-09-05. Dates are the source's published or
release date where the source exposes one; “current repository” means the live
official project page was inspected rather than a third-party summary.

| # | Primary source | Date / tested condition | Audit use |
|---:|---|---|---|
| 1 | [LivePortrait official repository](https://github.com/KlingAIResearch/LivePortrait) | Current repository; Windows and Linux instructions | Confirms portrait animation scope, inference options, and runtime shape. |
| 2 | [LivePortrait paper](https://arxiv.org/abs/2407.03168) | 2024-07-03 submission | Confirms implicit-keypoint portrait animation method and efficiency goal. |
| 3 | [MuseTalk official repository](https://github.com/TMElyralab/MuseTalk) | Current repository; v1.5 path | Confirms audio-driven lip synchronization, 256×256 mouth-region generation, and upstream requirements. |
| 4 | [LatentSync official repository](https://github.com/bytedance/LatentSync) | v1.6 released 2025-06-11 | Confirms maintained 512×512 lip-sync route and stated blur improvements. |
| 5 | [LatentSync paper](https://arxiv.org/abs/2412.09262) | 2024-12-12 submission | Confirms end-to-end latent diffusion lip synchronization method. |
| 6 | [JoyVASA official repository](https://github.com/jdh-algo/JoyVASA) | Current repository; Windows 11, CUDA 12.1, RTX 4060 laptop 8 GB tested upstream | Establishes the practical audio-driven motion challenger. |
| 7 | [V-Express official repository](https://github.com/tencent-ailab/V-Express) | Current repository; V100 figures published | Shows lower-VRAM but very slow research route and target-pose-video dependence. |
| 8 | [Hallo official repository](https://github.com/fudan-generative-vision/hallo) | Current repository | Establishes earlier hierarchical audio-driven portrait approach. |
| 9 | [Hallo3 official repository](https://github.com/fudan-generative-vision/hallo3) | Current repository; Linux, H100, English-only tested upstream | Rejects it as the practical Windows default. |
| 10 | [EchoMimic V3 official repository](https://github.com/antgroup/echomimic_v3) | Current repository | Confirms full-body audio-driven generation direction and substantial runtime footprint. |
| 11 | [HunyuanVideo-Avatar official repository](https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar) | Current repository; 24 GB minimum configuration published | Exceeds this machine's 12 GB VRAM default envelope. |
| 12 | [InfiniteTalk official repository](https://github.com/MeiGen-AI/InfiniteTalk) | Current repository | Confirms long-form audio-driven video scope and large diffusion stack. |
| 13 | [LongCat-Video official repository](https://github.com/meituan-longcat/LongCat-Video) | Current repository | Confirms official inference stack used to interpret prior local evidence. |
| 14 | [LongCat Avatar 1.5 project page](https://meigen-ai.github.io/LongCat-Video-Avatar-1.5-Page/) | Current project page | Provides official quality demonstrations; local identity drift still controls this product decision. |
| 15 | [OmniHuman project page](https://omnihuman-lab.github.io/) | Current page; no model/service release stated | Demo quality is not an integrable local route. |
| 16 | [AniPortrait official repository](https://github.com/Zejun-Yang/AniPortrait) | Current repository | Establishes audio-to-mesh and pose-driven alternative. |
| 17 | [SadTalker official repository](https://github.com/OpenTalker/SadTalker) | Current repository | Defines the preserved v1 presenter baseline and its license/runtime conditions. |
| 18 | [Wav2Lip official repository](https://github.com/Rudrabha/Wav2Lip) | Current repository; research/personal model condition | Rejects unqualified product-default use. |
| 19 | [Qwen3-TTS official repository](https://github.com/QwenLM/Qwen3-TTS) | Released 2026-01-22; 0.6B/1.7B, ten languages | Corrects stale app model IDs and defines current local TTS candidate. |
| 20 | [Qwen3-TTS paper](https://arxiv.org/abs/2601.15621) | 2026-01-22 submission | Confirms tokenizer, streaming, design, clone, and custom-voice system claims. |
| 21 | [Chatterbox official repository](https://github.com/resemble-ai/chatterbox) | Current repository | Confirms open multilingual TTS family and watermark behavior. |
| 22 | [Chatterbox v3 release](https://www.resemble.ai/chatterbox-v3/) | 2026-06-10 | Confirms 0.5B v3, expanded languages, and reduced-hallucination claims. |
| 23 | [F5-TTS official repository](https://github.com/SWivid/F5-TTS) | Current repository; CC-BY-NC model condition | Prevents treating permissive code as commercial model permission. |
| 24 | [CosyVoice official repository](https://github.com/FunAudioLLM/CosyVoice) | Current repository | Confirms multilingual streaming and model family. |
| 25 | [CosyVoice 3 paper](https://arxiv.org/abs/2505.17589) | 2025-05-23 submission | Confirms 0.5B/1.5B scaling and multilingual training claims. |
| 26 | [ElevenLabs TTS with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) | Current API reference | Establishes character and normalized-character alignment output. |
| 27 | [ElevenLabs model guide](https://elevenlabs.io/docs/overview/models) | Current documentation | Separates expressive v3 from stable long-form Multilingual v2. |
| 28 | [ElevenLabs Forced Alignment](https://elevenlabs.io/docs/capabilities/speech-to-text/forced-alignment) | Current documentation; 29 languages, no diarization, 10-hour maximum | Defines managed known-text alignment option and limits. |
| 29 | [Azure Speech visemes](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis-viseme) | Updated 2026-02-25; locale-dependent | Defines 22 visemes, audio offsets, `en-US` SVG limit, and 60 fps blend shapes. |
| 30 | [Google Cloud TTS SSML](https://cloud.google.com/text-to-speech/docs/ssml) | Current documentation | Confirms synthesis controls; it is not evidence of a known-text forced-alignment endpoint. |
| 31 | [Amazon Polly speech marks](https://docs.aws.amazon.com/polly/latest/dg/speechmarks.html) | Current documentation | Confirms sentence, word, viseme, and SSML timing metadata. |
| 32 | [OpenAI text-to-speech guide](https://platform.openai.com/docs/guides/text-to-speech) | Current documentation | Confirms current hosted speech capabilities and API conditions. |
| 33 | [NVIDIA Magpie TTS NIM support matrix](https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/tts.html) | Updated 2026-08-13; FP16, no WSL, 12.58 GiB minimum profile | Confirms languages, voices, memory, deployment, and platform limits. |
| 34 | [NVIDIA Magpie hosted API](https://build.nvidia.com/nvidia/magpie-tts-multilingual/api) | Current API; HTTP and gRPC | Confirms authorized hosted synthesis and live voice discovery route. |
| 35 | [NVIDIA Magpie voice and emotion guide](https://docs.nvidia.com/nim/speech/latest/tts/voices.html) | Updated 2026-08-13 | Confirms exact voice naming and limited emotion variants. |
| 36 | [NVIDIA Riva TTS overview](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/tts/tts-overview.html) | Current documentation | Confirms Magpie token/audio-codec architecture and Riva deployment alternative. |
| 37 | [WhisperX official repository](https://github.com/m-bain/whisperX) | Current repository; CUDA 12.8, Windows noted | Confirms wav2vec2 forced alignment, VAD, and token/language limitations. |
| 38 | [WhisperX paper](https://arxiv.org/abs/2303.00747) | 2023-03-01 submission | Establishes word-level alignment architecture and batched ASR method. |
| 39 | [WhisperX 3.7.8 release](https://github.com/m-bain/whisperX/releases/tag/v3.7.8) | 2025 release | Confirms backported CTC and blank-ID timestamp fixes. |
| 40 | [WhisperX issue 1315](https://github.com/m-bain/whisperX/issues/1315) | 2025 issue/fix trail | Documents cue timestamps incorrectly copied from segment starts. |
| 41 | [WhisperX issue 1298](https://github.com/m-bain/whisperX/issues/1298) | 2025 issue | Demonstrates number-token timing error risk. |
| 42 | [Montreal Forced Aligner documentation](https://montreal-forced-aligner.readthedocs.io/en/latest/) | Current documentation | Defines dictionary/acoustic-model known-transcript alignment route. |

## Remaining qualification gates

- Compare JoyVASA and LatentSync only after an exact-hash, license-reviewed pack
  exists; do not download a second large runtime into `C:`.
- Measure speech/rest mouth motion automatically across clean silence, noisy
  room tone, breaths, unvoiced consonants, and phrase boundaries.
- Run a multilingual set covering English and Hindi before selecting the local
  TTS default.
- Treat installed-app presentation, full tutorial rendering, clean-machine
  packaging, signing, and release as separate gates from this headless presenter
  component proof.
