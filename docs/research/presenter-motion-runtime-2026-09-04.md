# Presenter motion runtime: state-of-the-art review

**Date:** 2026-09-04  
**Target:** Windows 11, NVIDIA RTX 4080 Laptop GPU, 12 GB VRAM  
**Product:** AI Video Tutorial Generator

## Decision

The presenter must be animated by a model that produces coordinated facial expression, gaze, head pose, shoulders, and upper-body motion. A compositor transform is not an animation model. Moving or scaling the whole portrait to imitate breathing is prohibited.

The recommended runtime ladder is:

1. **Default local quality: EchoMimicV3-Flash.** It is the strongest practical open candidate found for this 12 GB Windows/NVIDIA target. The Flash release advertises eight-step inference, 12 GB VRAM use, 768 px output, audio-driven face/head/body motion, and an Apache-2.0 license. It should run in short, continuity-aware shots rather than attempting an uninterrupted three-minute generation.
2. **Fast local fallback: LivePortrait plus a curated motion library, followed by MuseTalk 1.5 or LatentSync only when lip repair is needed.** LivePortrait provides controllable pose, eye, and expression retargeting. The driver clips must contain natural, non-periodic motion. MuseTalk and LatentSync remain lip-sync tools; neither should be presented as full idle animation.
3. **Premium/high-compute route: HunyuanVideo-Avatar or InfiniteTalk.** These have a higher whole-body and long-form ceiling, but their model size, latency, and Windows integration cost make them opt-in or cloud/provider routes rather than the 12 GB default.
4. **Rigged 3D characters: NVIDIA Audio2Face/ACE.** This is the appropriate route for an actual 3D teacher with a face/body rig, not for animating a flat photoreal portrait.

The old renderer fallback that applied periodic FFmpeg scale/crop movement to a `lip-sync-only` clip has been removed. A runtime may declare `native-idle` only when it generated spatially local motion itself.

## Why the previous result looked cheap

The rejected sample moved the entire presenter image with a sinusoidal transform. That makes the face, hair, shoulders, clothes, and background rise together at the same velocity. Human breathing does not behave this way: motion is localized around the chest and shoulders, while blinks, gaze shifts, micro-expressions, and head corrections happen on different, irregular timescales.

Research systems converge on a decomposed or staged solution:

- **GoHD** separates fast, audio-related facial motion from slower motion such as blinks and frowns, while modelling gaze and head pose separately.
- **FantasyTalking/FantasyTalking2** generate coherent global motion before frame-level lip refinement and expose motion-intensity control.
- **Sonic** explicitly disentangles head motion and expression while using broader audio context.
- **Teller** decomposes facial and body detail for streaming portrait animation.

The practical lesson is not to stack arbitrary visual effects. Generate coherent global motion first; repair the mouth only if objective A/V checks show that it needs repair.

## Recommended production pipeline

```text
consented portrait or presenter video
  -> source QA (closed/resting mouth, front-facing, shoulders visible, clean background)
  -> shot planner (speech energy, semantic beats, gaze targets, gesture intensity)
  -> whole-presenter motion generation
  -> optional lip repair, restricted to the mouth aperture
  -> temporal/identity/A-V quality gates
  -> presenter/slide composition
  -> final visual review
```

### Shot planning

- Do not keep a talking head visible for the full tutorial. Use the presenter for the opening, transitions, summaries, and direct-address moments. Let diagrams, code, and whiteboard work occupy the frame while the explanation is visual.
- Generate four-to-eight-second shots with overlapping handles. Re-anchor identity at shot boundaries and hide joins behind slide changes, camera reframes, or natural pauses.
- Derive motion intensity from speech energy and punctuation, but do not map every syllable to head movement.
- Use non-periodic blink and gaze schedules. Avoid metronomic blinking, repeated nod loops, and constant motion.
- Offer restrained, conversational, animated, and custom motion presets. The restrained preset should still contain genuine micro-motion.

### Local 12 GB route

EchoMimicV3-Flash is the first model to benchmark. The published checkpoint is about **3.73 GB**, while its Wan2.1-Fun 1.3B inpainting base is about **19 GB**; auxiliary audio weights and the isolated runtime put the practical installation above **23 GB**. All of it belongs under `E:\temp`, never C:.

Twelve gigabytes is the model's stated floor and this laptop GPU also drives the display, so acceptance requires a measured Windows benchmark with CPU offload or quantization where supported. The application must show the exact download and disk requirement before installation and must never silently claim support merely from model metadata.

### Fast fallback route

LivePortrait should use curated driver clips whose motion is subtle, asymmetrical, and appropriate for teaching. Separate driver families should cover attentive listening, calm explanation, emphasis, uncertainty, and conclusion. The source audio must remain authoritative. A second lip pass is allowed only when sync measurement fails, and replacement pixels must stay inside a feathered mouth aperture to preserve facial hair and identity.

If no true motion runtime is installed, the product should render a clean static or lip-synced presenter and label that limitation. It must not synthesize fake breathing with a whole-frame transform.

## Quality gates

Each generated presenter shot must pass all applicable checks before it can be used automatically:

| Gate | What is measured | Reject when |
|---|---|---|
| Whole-frame motion | Optical flow in background and stable clothing regions | The entire crop translates or scales together |
| Motion locality | Face landmarks plus shoulder/chest flow | “Breathing” is only camera/portrait movement |
| Lip sync | SyncNet-style confidence and estimated A/V offset | Confidence falls below the calibrated runtime threshold or offset is visible |
| Identity | Face-embedding similarity against approved source frames | Identity drifts, facial hair disappears, or features warp |
| Temporal stability | Landmark acceleration, flow discontinuities, and seam deltas | Jitter, frozen-to-moving jumps, or chunk seams are visible |
| Eyes | Closure completeness, geometry, and cadence | Partial eyelid smears, simultaneous eye warps, or a periodic loop appears |
| Pose | Yaw/pitch/roll continuity | Repetitive nodding, unnatural neck motion, or crop collisions occur |
| Human review | Contact sheet plus real-time and half-speed playback | The result merely satisfies numeric checks but still looks synthetic or cheap |

Background stability is a mandatory regression test. A model-generated shoulder rise may be valid; identical vertical flow across the background, hair, face, and torso is not.

## Model assessment

| Runtime | Strength | Main limitation | Role |
|---|---|---|---|
| EchoMimicV3-Flash | Unified face/head/body motion, 12 GB claim, 8-step path, permissive license | Tight VRAM floor; requires Windows benchmark and chunk continuity work | Default local candidate |
| LivePortrait | Fast, controllable pose/expression/eye retargeting; Windows support | Quality depends on a good driver; not audio-driven full-body generation | Fast local fallback |
| MuseTalk 1.5 | Fast local lip synchronization | Alters only the mouth/face region and can damage identity details | Mouth repair only |
| LatentSync 1.6 | Diffusion lip sync at higher resolution with temporal modelling | More VRAM and still lip-only | Higher-quality mouth repair |
| EchoMimicV2 | Audio/pose-conditioned half-body animation | Older and materially slower | Secondary compatibility route |
| HunyuanVideo-Avatar | Dynamic, emotion-controllable body and face motion; low-VRAM mode reported | Heavy model/runtime and long-form cost | Premium local/cloud |
| InfiniteTalk | Long-form image/video-to-video audio-driven motion | Wan 14B class, expensive; upstream notes long-clip colour shift | Premium/cloud |
| Hallo3/Hallo4 | High-dynamic portrait generation and preference alignment | Heavy research runtime; weaker Windows product fit | Experimental quality tier |
| AniPortrait | Audio-driven face plus pose control | Older visual ceiling | Compatibility/experimentation |
| SadTalker/Wav2Lip | Mature and widely understood | Older motion quality or lip-only behavior | Legacy compatibility, not default |
| NVIDIA Audio2Face | Strong real-time facial animation for rigged 3D assets | Requires a 3D character and rig | 3D presenter category |

## Product behavior

- Model routing must remain capability-based. `portrait-animation` and `lip-sync` are distinct capabilities and may come from different providers.
- The editor should expose motion style, intensity, gaze direction, gesture frequency, shot length, and deterministic seed where supported.
- Provider-specific timestamps are adapters, not product assumptions. Alignment is normalized into the application's provider-independent timing contract.
- Local and API providers must return the same semantic outputs: media, frame rate, duration, motion capability, provenance, revision, seed when available, and quality metrics.
- Download cards must show checkpoint, auxiliary-model, and runtime sizes separately, plus projected peak VRAM/RAM and free-disk checks.
- Generated media stays editable: users can replace a shot, adjust motion, choose another presenter/runtime, or disable the presenter without regenerating unrelated scenes.

## Sources reviewed

Primary repositories, project pages, papers, and vendor documentation reviewed for this decision:

1. [EchoMimicV3 official repository](https://github.com/antgroup/echomimic_v3)
2. [EchoMimicV3-Flash checkpoint](https://huggingface.co/BadToBest/EchoMimicV3/tree/main/echomimicv3-flash-pro)
3. [Wan2.1-Fun V1.1 1.3B inpainting base](https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP)
4. [EchoMimicV2 official repository](https://github.com/antgroup/echomimic_v2)
5. [EchoMimicV2, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Meng_EchoMimicV2_Towards_Striking_Simplified_and_Semi-Body_Human_Animation_CVPR_2025_paper.html)
6. [EchoMimic official repository](https://github.com/antgroup/echomimic)
7. [LivePortrait official repository](https://github.com/KlingAIResearch/LivePortrait)
8. [LivePortrait paper](https://arxiv.org/abs/2407.03168)
9. [MuseTalk official repository](https://github.com/TMElyralab/MuseTalk)
10. [LatentSync official repository](https://github.com/bytedance/LatentSync)
11. [GoHD, AAAI 2025](https://ojs.aaai.org/index.php/AAAI/article/view/33186)
12. [FantasyTalking](https://arxiv.org/abs/2504.04842)
13. [FantasyTalking2](https://arxiv.org/abs/2508.11255)
14. [HunyuanVideo-Avatar official repository](https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar)
15. [InfiniteTalk official repository](https://github.com/MeiGen-AI/InfiniteTalk)
16. [Hallo official repository](https://github.com/fudan-generative-vision/hallo)
17. [Hallo2](https://arxiv.org/abs/2410.07718)
18. [Hallo3 official repository](https://github.com/fudan-generative-vision/hallo3)
19. [Hallo3 paper](https://arxiv.org/abs/2412.00733)
20. [Hallo4](https://arxiv.org/abs/2505.23525)
21. [AniPortrait official repository](https://github.com/Zejun-Yang/AniPortrait)
22. [AniPortrait paper](https://arxiv.org/abs/2403.17694)
23. [Sonic, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Ji_Sonic_Shifting_Focus_to_Global_Audio_Perception_in_Portrait_Animation_CVPR_2025_paper.html)
24. [Teller, CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/html/Zhen_Teller_Real-Time_Streaming_Audio-Driven_Portrait_Animation_with_Autoregressive_Motion_Generation_CVPR_2025_paper.html)
25. [FLOAT, ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/html/Ki_FLOAT_Generative_Motion_Latent_Flow_Matching_for_Audio-driven_Talking_Portrait_ICCV_2025_paper.html)
26. [Long-Term TalkingFace, ICML 2025](https://proceedings.mlr.press/v267/shen25g.html)
27. [OmniHuman-1](https://arxiv.org/abs/2502.01061)
28. [OmniAvatar](https://arxiv.org/abs/2506.18866)
29. [MegActor-Sigma official repository](https://github.com/megvii-research/megactor)
30. [VASA-1 project page](https://www.microsoft.com/en-us/research/project/vasa-1/)
31. [SadTalker official repository](https://github.com/OpenTalker/SadTalker)
32. [Wav2Lip paper](https://arxiv.org/abs/2008.10010)
33. [NVIDIA ACE overview](https://docs.nvidia.com/ace/overview/2025.04.28/index.html)
34. [NVIDIA Audio2Face](https://www.nvidia.com/en-us/omniverse/apps/audio2face/)

## Acceptance before changing the default

EchoMimicV3-Flash becomes the default only after the reference laptop completes a locked, headless benchmark covering cold start, five-second and thirty-second shots, peak VRAM/RAM, render factor, identity stability, lip sync, chunk seams, cancellation, resume behavior, and GPU-lock restoration. Until then the UI must call it **candidate** rather than **installed**, **verified**, or **recommended for this PC**.
