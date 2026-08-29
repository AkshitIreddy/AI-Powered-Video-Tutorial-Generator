# Starter audio design and verification

The Alystria starter pack is a restrained baseline for tutorial makers who do
not yet have their own music or sound library. It is intentionally small,
editable, rights-clear, and disabled by default. Users can replace any starter
asset with their own imported content; project provenance must continue to
distinguish bundled, user-owned, licensed, and generated material.

## Design decisions

- **Audio never substitutes for state.** Success, warning, quiz, and emphasis
  cues require a persistent text/icon/motion alternative. This follows WCAG's
  non-interference guidance and Microsoft's additional-channel guidance.
- **No automatic sound.** Catalog policy disables autoplay, music, effects, and
  stingers. Long-form background audio must always have independent controls.
- **Narration stays primary.** Both ambient loops recommend a low initial level
  and another 8 dB duck while narration is active. At their catalogued playback
  levels, their measured integrated loudness sits more than 20 dB below a
  -16 LUFS narration master.
- **Variation is explicit.** Frequent interaction cues have A/B variants, so a
  player can alternate them without silently changing semantics. Small pitch or
  level randomization may be applied only within user-approved bounds.
- **Loops are sample-continuous.** Each oscillator completes an integer number
  of cycles over a 12-second file. The verifier compares the seam step with the
  neighboring waveform derivatives instead of incorrectly requiring the first
  and last discrete samples to be identical.
- **Headroom survives composition.** Source files target -4.8 dBFS sample peak
  for one-shots and -6 dBFS for loops. FFmpeg measures BS.1770 integrated
  loudness and four-times-oversampled true peak; the pack gate is -2 dBTP with
  zero clipped samples.
- **Lossless local masters.** Assets use stereo, 48 kHz, 24-bit PCM WAV. Delivery
  compression, if desired, belongs at the final export boundary rather than in
  the reusable source library.

## Verification contract

`assets/starter/audio/verification.json` is the machine-readable evidence. A
passing file has:

- zero clipped samples;
- true peak at or below -2 dBTP;
- DC offset at or below -70 dBFS;
- one-shot tail RMS at or below -58 dBFS, or loop derivative mismatch at or
  below -52 dBFS;
- recorded RMS, onset, tail, spectral flatness, high-frequency share, spectral
  centroid, integrated LUFS, and true peak measurements.

The spectral probe uses the highest-energy 4096-sample window and a Hann-windowed
FFT. It is useful for catching accidental broadband hiss, but it is not a
substitute for listening. Human review remains an explicit release requirement.

## Evidence ledger

Research was last reviewed on 2026-08-29. The implementation follows the
points of convergence across current standards, platform guidance, engine
documentation, and production middleware:

1. [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I) defines programme loudness and true-peak measurement.
2. [EBU R 128 v5](https://tech.ebu.ch/publications/r128) specifies loudness normalization and maximum true peak.
3. [EBU loudness overview](https://tech.ebu.ch/loudness/) explains the loudness-first workflow.
4. [EBU PLoud guidance](https://tech.ebu.ch/groups/ploud-old) distinguishes R 128 programme compliance from EBU meter mode.
5. [EBU ADM loudness metadata](https://adm.ebu.io/reference/adm_elements/loudness_metadata.html) records integrated loudness, true peak, range, and short-term values.
6. [AES-R7-2018](https://www.aes.org/publications/standards/preview.cfm?ID=54) explains why sample peak alone misses inter-sample overloads.
7. [AES TD1008](https://aes.org/wp-content/uploads/2024/01/20210924_TD1008_v3.13.pdf) recommends true-peak-aware distribution and warns against excessive limiting.
8. [EBU Tech 3285](https://tech.ebu.ch/docs/tech/tech3285.pdf) specifies interoperable Broadcast Wave PCM and metadata.
9. [ITU-R BS.1352-4](https://www.itu.int/rec/R-REC-BS.1352) covers exchange of audio programme material with metadata.
10. [FADGI BWF metadata guidance](https://www.digitizationguidelines.gov/guidelines/digitize-embedding.html) emphasizes durable identifiers, responsibility, and machine-readable audio metadata.
11. [Microsoft WAVE data types](https://learn.microsoft.com/en-us/windows/win32/multimedia/devices-and-data-types) documents PCM packing and channel order.
12. [Microsoft WAVEFORMATEX](https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/ns-mmeapi-waveformatex) documents channel, sample-rate, alignment, and bit-depth fields.
13. [W3C WCAG audio control](https://www.w3.org/WAI/WCAG21/Understanding/audio-control) discourages automatic sound and requires independent control for longer audio.
14. [W3C accessible audio/video production](https://www.w3.org/WAI/media/av/av-content/) recommends background audio at least 20 dB below speech.
15. [W3C time-based media guidance](https://www.w3.org/WAI/WCAG21/Understanding/time-based-media.html) requires alternatives for synchronized media.
16. [W3C ACT autoplay rule](https://www.w3.org/WAI/standards-guidelines/act/rules/80f0bf/proposed/) tests that automatically playing audio can be controlled.
17. [Microsoft visual alternatives for sounds](https://support.microsoft.com/en-us/accessibility/windows/use-text-or-visual-alternative-to-sounds) demonstrates non-audio notification channels.
18. [Xbox Accessibility Guideline 103](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/103) requires visual and audio cues through multiple sensory methods.
19. [Apple playing-audio guidance](https://developer.apple.com/design/human-interface-guidelines/playing-audio) recommends meaningful feedback, non-audio alternatives, and subtle variation for repeated sounds.
20. [Unreal Audio Engine overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-engine-overview-in-unreal-engine) treats UI feedback as non-spatial 2D audio and exposes DSP/mixing controls.
21. [Unreal seamless-loop guidance](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/USoundNodeLooping) distinguishes true wave-player looping from logical retriggering.
22. [Unity AudioSource](https://docs.unity3d.com/Manual/class-AudioSource.html) documents 2D playback and loop controls.
23. [Unity audio tutorial](https://learn.unity.com/tutorial/add-game-audio) treats background music as independently replaceable licensed content.
24. [FMOD instrument workflow](https://www.fmod.com/docs/2.03/studio/working-with-instruments.html) documents retrigger behavior, envelopes, playlists, and looping.
25. [FMOD Unity integration](https://www.fmod.com/docs/2.03/unity/integration-tutorial.html) routes music separately from effects for later mix control.
26. [Wwise sound properties](https://www.audiokinetic.com/library/2024.1.2_8726/?id=wwiseobject_sound.html&source=SDK) expose source normalization, pitch, loop, and playback limits as separate controls.

The standards define measurement and accessibility boundaries rather than a
single creative loudness target for every one-shot. Alystria therefore stores
measured source properties and conservative playback gains, then masters the
final tutorial mix as a whole.
