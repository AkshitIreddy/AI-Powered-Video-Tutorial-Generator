# Voice and presenter quality decision — 2026-09-01

## Production default

- Use ElevenLabs `eleven_multilingual_v2` for long-form tutorials. ElevenLabs positions it as the stable, high-quality multilingual model, while Eleven v3 is more expressive but more variable.
- Use the premade Alice voice (`Xb7hH8MSUJpSbSDYk0k2`) as Alystria's fresh-install educator default. It is a public voice identifier, not a credential.
- Start with stability `0.50`, similarity `0.78`, style `0`, speaker boost enabled, and user-selected speed. These are deliberately conservative long-form settings; profiles may still choose another exact voice and model.
- Long-form Alice timing varies materially with equations and punctuation. A live 401-word Karatsuba script measured 202.526 seconds at speed `0.74`, so the production educator profile uses a still-calm `0.86`. The writer targets 2.05 words per second (123 wpm), while Alystria measures the returned MPEG audio frames and redistributes the exact requested duration as real speech plus equal short visual breaths. Text-length estimates are never used to trim delivery audio.
- Keep all credentials in Alystria's existing OS-vault/ephemeral-grant path. No key is stored in a project, request, log, or repository file.

Primary references:

- [ElevenLabs models](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs voice settings](https://elevenlabs.io/docs/product-guides/voices/voice-settings)
- [ElevenLabs text-to-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [NVIDIA Riva TTS overview](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/tts/tts-overview.html)

## Why not label NVIDIA NIM as the voice route

NVIDIA's high-quality Magpie speech stack is exposed through Riva deployment. A hosted NVIDIA NIM language-model key is not itself a drop-in hosted TTS endpoint. Alystria can add a separately installed and approved Riva route later, but it must not silently reinterpret an NIM writing key as speech access.

## Lip-sync decision

MuseTalk 1.5 is retained for the current modest-VRAM local presenter pack. Its semantic mask is changed from `jaw` to `raw`, then Alystria constrains the colour-matched generated composite to a small, feathered lip aperture. The upstream project explicitly lists loss of identity detail around the mouth, including mustaches, as a known limitation. Both the dilated jaw mask and the unbounded raw lower-face composite replaced too much facial hair; the aperture keeps source-portrait pixels outside the moving lips.

The next high-quality opt-in candidate is LatentSync 1.6 when the machine has roughly 18 GB of free VRAM; its 1.5 configuration is lighter. It is not a safe automatic replacement for every Windows/NVIDIA installation yet.

Primary references:

- [MuseTalk repository and limitations](https://github.com/TMElyralab/MuseTalk)
- [LatentSync repository and VRAM guidance](https://github.com/bytedance/LatentSync)
- [LivePortrait paper](https://arxiv.org/abs/2407.03168)
- [NVIDIA Audio2Face-2D](https://build.nvidia.com/nvidia/audio2face-2d)

## Slide-generation boundary

The approved structured-writing model now authors the educational outline, narration, scene family, short on-screen labels, and semantic information units. Alystria owns validation, exact timing, responsive typography, diagrams, and motion. Image providers receive an explicit text-free supporting-art brief, and newly generated background candidates stay provenance-only until visual review approves them. This prevents both pseudo-text slide copy and pseudo-glyph artifacts from being painted beneath authoritative layout; explicit project and starter backgrounds remain supported.
