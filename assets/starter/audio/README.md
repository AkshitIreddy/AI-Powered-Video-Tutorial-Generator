# Alystria Starter Audio

This directory contains Alystria-authored, deterministic starter sounds. The
pack uses procedural synthesis only: no recordings, sample libraries,
third-party media, generative-AI output, or downloaded material is present.

The 16 assets comprise:

- four intro/outro stingers;
- two variants each for UI success, UI warning, emphasis, quiz success, and
  neutral quiz reveal;
- two 12-second seamless ambient loops.

Every file is 48 kHz, stereo, lossless 24-bit PCM WAV. `catalog.json` contains
the path, SHA-256 digest, byte size, format, mix guidance, accessibility
alternative, provenance, license, and measured audio properties for each
asset. `verification.json` records the deterministic sample-probe and FFmpeg
BS.1770/true-peak gates.

## Safe defaults

Music, sound effects, stingers, and autoplay are all **off by default**. Audio
never carries essential information by itself. Every cue has a catalogued
visual alternative, and ambient loops declare an additional narration-duck
recommendation. A product surface must preserve independent music/effects
volume and mute controls when it exposes these assets.

## License and provenance

Copyright (c) Alystria Studio contributors. The generator and generated audio
are distributed under the repository's MIT License. Their machine-readable
provenance declares `rightsStatus: owned`, `licenseExpression: MIT`, no
ingredients, no third-party samples, and no generative AI.

## Rebuild and verify

From the repository root, pass an explicitly reviewed FFmpeg executable:

```text
python assets/starter/audio/tools/generate.py --ffmpeg <path-to-ffmpeg>
```

The command regenerates all PCM files, refreshes their hashes and measurements,
and exits non-zero if clipping, true peak, DC offset, tail, or seamless-loop
gates fail. Automated measurements cannot determine whether a sound is
pleasant; a release candidate still needs a human listening pass on headphones
and ordinary laptop speakers.
