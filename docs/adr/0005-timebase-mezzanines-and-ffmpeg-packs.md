# ADR 0005: 240 kHz timebase, FFV1 mezzanines, and FFmpeg runtime packs

- Status: Accepted; release packs unverified
- Date: 2026-08-28

## Context

Narration, captions, animation, presenters, and video frames need one exact
timeline. Scene-local regeneration must avoid lossy recompression, while final
delivery needs codec probing, audio mastering, and license-aware H.264 support.

## Decision

Use 240,000 integer ticks per second. This exactly represents 48 kHz samples and
the supported common integer and NTSC-family frame rates; conversion uses
integer/rational arithmetic with explicit floor/ceiling rules.

Pinned Chromium emits authoritative frames. Each scene is encoded as lossless
10-bit RGB FFV1 in Matroska, allowing unchanged scenes to be concatenated or
reused without generational loss. FFmpeg/ffprobe owns probing, assembly, audio
mixing, EBU R128 mastering, delivery encoding, and decode validation. Standard
output is sRGB/Rec.709 SDR; HDR is outside 2.0 core.

Ship a signed LGPL-compatible FFmpeg core pack. Use platform/hardware H.264 when
available. Make `libx264` available only through a separately installed,
explicitly selected, signed GPL pack whose license boundary is visible.

## Consequences

- Timeline math is stable across scene, caption, and audio systems.
- Scene caches are larger than lossy intermediates but support reliable partial
  regeneration.
- Every encoder is probed before use; missing support is an actionable error,
  not a silent codec switch.
- FFmpeg configuration and notices become release artifacts.

## Current evidence and release gates

The timebase, FFV1 plan, FFmpeg argument construction, codec capability parsing,
GPL/nonfree warnings, audio master, output probing, and short real development
render are implemented and tested.

The local FFmpeg used for development is an older GPL-enabled host build and
must not be redistributed. Release remains blocked on immutable signed LGPL and
optional GPL packs, provenance/license review, installer/update/rollback tests,
and the complete target/FPS/codec matrix.
