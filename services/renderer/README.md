# Alystria Renderer

The renderer is a deterministic, frame-driven subsystem. It does not use Remotion, wall-clock time, network assets, autonomous CSS animation, or unseeded randomness. The same pure `FrameRenderer` entry point powers preview and final output.

Core guarantees:

- 240,000 ticks per second exactly represents 24, 25, 30, 50, 60, 23.976, 29.97 and 59.94 fps plus 48 kHz samples.
- Responsive layouts are compiled independently for wide, tall and balanced targets.
- Scene renderers receive an explicit `FrameContext` and a deterministic `SeededRandom` instance.
- `Math.random`, `Date.now`, and (where configurable) `performance.now` throw during render.
- Browser capture uses `playwright-core`, denies every browser-context request, and verifies the selected Chromium executable version and SHA-256 before producing authoritative PNGs.
- The render executor captures with bounded page concurrency, checkpoints every completed frame for resume, and renders full projects, one scene, a frame range, or a resolution-limited draft.
- FFmpeg is spawned directly with argument arrays (never a shell) for the FFV1 mezzanine, exact-duration 48 kHz master, captioned delivery, structured ffprobe QA, and full decode validation.
- WebVTT is canonical, with SRT and deterministic SVG caption overlays derived from the same cues.

## Commands

```bash
pnpm --filter @alystria/renderer build
pnpm --filter @alystria/renderer test
pnpm --filter @alystria/renderer test:render
node services/renderer/dist/src/cli.js frame --fixture 45 render-output/frame-000045.svg
node services/renderer/dist/src/cli.js parity --fixture 45
node services/renderer/dist/src/cli.js render --fixture \
  --browser /path/to/pinned/chromium \
  --ffmpeg /path/to/ffmpeg \
  --ffprobe /path/to/ffprobe \
  --codec vp9 \
  --output-dir render-output
```

`render` is the authoritative execution command. It writes `render-progress.jsonl`,
resumable frames under `.render-cache`, caption sidecars, `mezzanine.mkv`, a
48 kHz audio master (silence when no source audio exists), the delivery file,
and `render-output.json` containing hashes and ffprobe measurements. `SIGINT` or
`SIGTERM` cancels active browser/FFmpeg work while preserving completed-frame
checkpoints. Temporary attempt directories are always removed.

The browser path can be omitted when the revision-pinned Chromium installed for
`playwright-core` is available. Packaged builds should pass exact browser,
FFmpeg, and ffprobe paths plus the expected browser version/SHA-256. The desktop
supervisor can call `executeRender()` directly and provide its own `AbortSignal`,
progress listener, browser factory, or command runner.

For local development, discover FFmpeg with diagnostics and record `ffmpeg -version`, `-buildconf`, and `-encoders`. A developer-installed GPL build may be used for tests but is not evidence that the binary can be bundled with Alystria Studio's MIT core.
