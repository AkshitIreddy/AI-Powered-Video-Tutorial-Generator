# Presenter motion runtime: measured Windows decision

> **Re-audited 2026-09-05:** See
> [`presenter-voice-audit-2026-09-05.md`](presenter-voice-audit-2026-09-05.md).
> The hybrid remains the practical installed 12 GB route, but fresh evidence
> measured roughly 50× real time and exposed MuseTalk mouth motion during true
> silence. The newer audit records the source-frame silence repair, its fresh
> replay, current voice/alignment choices, and newer practical challengers.

**Date:** 2026-09-04

**Target:** Windows 11, NVIDIA RTX 4080 Laptop GPU, 12 GB VRAM, 32 GB RAM

**Product:** AI Video Tutorial Generator

## Decision

Use **LivePortrait followed by MuseTalk 1.5** as the default local presenter route.

- LivePortrait owns pose, gaze, expression, eyelids, head motion, and shoulder motion.
- MuseTalk owns narration-accurate mouth motion only.
- The stages are independent capabilities. A different lip-sync provider can replace MuseTalk without changing the motion stage or the application timing contract.
- The source portrait remains the identity anchor. The motion stage runs first so lip repair cannot erase blinks or reduce the result to a moving still image.
- The application must never imitate breathing by moving or scaling the entire portrait.

The chosen test presenter is **Amara**, a front-facing, closed-mouth teacher portrait without the facial mole present on the rejected presenter.

## What was run

Every local test was headless. Large source trees, checkpoints, virtual environments, logs, and media stayed under `E:\temp`. AI inference held the shared GPU lock and restored it afterward.

| Runtime | Actual test | Time | Peak GPU memory | Result |
|---|---:|---:|---:|---|
| LivePortrait | 16.48 s native presenter-motion clip | 61.96 s | 2,655 MiB | Passed. Real eyelid closure, gaze/head/shoulder motion, and strong identity retention. |
| MuseTalk 1.5 after LivePortrait | 3.24 s voiced hybrid clip | 66.73 s for the lip stage; 128.69 s total | 7,913 MiB | **Winner.** Preserved Amara while adding narration mouth shapes and retaining the LivePortrait blink. |
| LongCat Video Avatar 1.5 INT8, WanGP profile 5 | 49 frames / 1.96 s | 587.05 s after model installation | 4,685 MiB | Failed the visual gate. Eye colour, face shape, skin detail, and mouth geometry drifted; motion was more extensive but identity was not trustworthy. |
| EchoMimicV3-Flash | 512 px, 49 frames, 8 steps | Stopped after 386.92 s before frame one | About 500 MiB GPU while paging | Failed the hardware gate. The process committed about 46.33 GB and exhausted practical system memory even with offload. |
| HunyuanVideo-Avatar | Hardware preflight | Not run | Official minimum is 24 GB VRAM | Disqualified as a default on this 12 GB GPU. Keep as a larger-GPU or provider route. |
| InfiniteTalk | Runtime/schema preflight | Not run | Wan 14B-class route | Superseded for this comparison by the newer LongCat route, while retaining the same large-model latency/installation class. |

The local hybrid clip is:

`E:\temp\avt-presenter-bench-2026-09-04\hybrid-amara\v15\amara-liveportrait-musetalk.mp4`

The fresh application-owned broker run, its independent report, and its contact sheet are:

`E:\temp\AI Video Tutorial Generator\benchmarks\presenter-runtime-2026-09-04\managed-hybrid-smoke-v3`

The LongCat comparison clip and its measurements are:

`E:\temp\AI Video Tutorial Generator\benchmarks\presenter-runtime-2026-09-04\longcat-avatar-1.5`

## Visual decision

LongCat generated the broadest movement, including a hand gesture, but that did not make it the best presenter renderer. The test changed stable identity attributes and produced an implausibly wide mouth. For tutorial content, a believable, consistent teacher is more valuable than a larger gesture envelope that changes who the teacher appears to be.

The hybrid retained the source identity and added motion in the right places. The verified contact sheet contains a complete eyelid closure rather than a portrait-wide bob. The final mouth rests closed when narration stops. Its weaknesses are bounded and tractable: motion quality depends on the motion-template library, and MuseTalk should remain restricted to a feathered facial region.

## Production architecture

```text
approved presenter portrait
  -> source QA (front-facing, closed/resting mouth, shoulders visible)
  -> shot and motion planner
  -> LivePortrait motion template (pose, gaze, blink, expression, shoulders)
  -> provider-independent narration timing
  -> optional MuseTalk 1.5 lip pass
  -> identity, eye, motion-locality, temporal, and A/V gates
  -> slide/presenter composition
  -> contact-sheet and real-time visual review
```

### Motion templates

The default cannot be one short loop repeated for an entire tutorial. Build a deterministic library of source motion with several teaching modes:

- attentive neutral
- calm explanation
- light emphasis
- strong emphasis
- reflective pause
- summary and conclusion

Each clip should contain irregular blinks, small gaze corrections, asymmetric shoulder/chest movement, and occasional head emphasis. The shot planner chooses and blends templates from narration energy and semantic beats. Repeated nods, periodic blinks, constant swaying, and whole-frame movement are rejection conditions.

Presenter shots should normally be four to eight seconds and appear at openings, transitions, summaries, and direct-address moments. Slides, diagrams, code, and whiteboard work should take visual priority while the presenter is not adding value.

### Provider independence

The hybrid is a route, not an ElevenLabs-specific feature. Voice and timestamp adapters normalize into a shared timing model containing words/phonemes where available, sentence boundaries, pauses, duration, and confidence. If a provider supplies only audio, the app derives alignment locally. The selected portrait-motion and lip-sync models can therefore be changed independently.

## Quality gates

| Gate | Reject when |
|---|---|
| Identity | Eye colour, facial proportions, hair, skin detail, facial hair, or other approved attributes drift. |
| Eyes | Blinks smear, stop halfway, become periodic, or deform both eyes. |
| Mouth | The resting mouth remains open, shapes become exaggerated, teeth smear, or identity details disappear. |
| Motion locality | Background and body move together as if the entire image was translated or scaled. |
| Pose | Head movement loops, the neck warps, or the presenter collides with the frame. |
| Temporal stability | Frames jitter, motion freezes between chunks, or joins flash. |
| A/V alignment | The visible offset exceeds the calibrated route threshold or confidence is too low. |
| Human review | The whole clip or frame sheet still looks synthetic, cheap, or unlike the approved presenter. |

Numeric checks are necessary but do not replace visual inspection. Each release sample needs real-time playback, half-speed playback, and a frame/contact-sheet review.

## Product behavior

- `portraitAnimation` and `lipSync` remain separate profile routes.
- The setup UI preselects LivePortrait and MuseTalk 1.5 on the reference configuration and shows their complete download sizes before installation.
- LongCat remains visible as a high-compute experiment, not a recommendation for this machine.
- EchoMimicV3-Flash is marked incompatible on this reference PC rather than “recommended.”
- HunyuanVideo-Avatar is a larger-GPU/provider option.
- InfiniteTalk remains a legacy comparison route.
- A user can disable either presenter stage, replace either model/provider, adjust motion style and intensity, or regenerate one shot without regenerating unrelated scenes.
- Runtime artifacts are hash-pinned. The hybrid worker verifies both the MuseTalk source manifest and the LivePortrait source manifest before denying network access and starting inference.

## Primary sources

1. [LivePortrait official repository](https://github.com/KlingAIResearch/LivePortrait)
2. [LivePortrait paper](https://arxiv.org/abs/2407.03168)
3. [MuseTalk official repository](https://github.com/TMElyralab/MuseTalk)
4. [EchoMimicV3 official repository](https://github.com/antgroup/echomimic_v3)
5. [EchoMimicV3-Flash checkpoint](https://huggingface.co/BadToBest/EchoMimicV3/tree/main/echomimicv3-flash-pro)
6. [HunyuanVideo-Avatar official repository](https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar)
7. [InfiniteTalk official repository](https://github.com/MeiGen-AI/InfiniteTalk)
8. [LongCat Video official repository](https://github.com/meituan-longcat/LongCat-Video)
9. [LongCat Video Avatar 1.5 checkpoint](https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5)
10. [LongCat Video Avatar 1.5 project page](https://meigen-ai.github.io/LongCat-Video-Avatar-1.5-Page/)
11. [WanGP official repository](https://github.com/deepbeepmeep/Wan2GP)
12. [LatentSync official repository](https://github.com/bytedance/LatentSync)

## Acceptance status

The measured hybrid passes the component-level selection gate and a fresh application-owned, exact-hash broker run. It is the default local runtime choice. Full product acceptance still requires a three-minute generated tutorial using Amara, cancellation/recovery checks, and final frame-by-frame video QA. Those are release gates, not reasons to keep the inferior benchmark candidates as the default.
