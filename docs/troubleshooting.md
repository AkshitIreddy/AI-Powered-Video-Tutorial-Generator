# Troubleshooting

Start with `pnpm doctor` in a development checkout or Settings → Diagnostics in the installed application. Diagnostics must distinguish missing, incompatible, disabled, busy, and unverified components.

## Desktop opens but workers are unavailable

Verify protocol/schema versions, loopback or pipe availability, worker executable checksums, and whether security software quarantined a sidecar. Do not work around the issue by exposing a worker on all interfaces or disabling authentication. Collect the redacted diagnostics preview and restart through the app so supervision remains intact.

## A job remains `RUNNING` after a crash

Wait for the worker lease to expire or use the recover action. Recovery reconciles accepted provider requests before retrying. Never edit SQLite state manually or delete the WAL. If recovery cannot prove whether a billable request was accepted, it blocks for review rather than issue a duplicate.

## FFmpeg or Chromium is missing

Run runtime diagnostics. The app reports the required pinned version, discovered path, hash, build configuration, and license profile. Install or repair through the signed runtime manager. Avoid substituting an arbitrary system binary for release-candidate verification because output and codec behavior may differ.

## GPU model will not load

Check driver compatibility, actual free VRAM, conflicting GPU processes, model checksum, quantization, and runtime version. The scheduler loads one GPU-heavy family at a time on the reference 12 GB profile. CPU fallback is explicit and updates ETA. Silent mode or disabled CPU boost is not itself a model-integrity failure.

## Render is slow

First separate correctness from performance. Confirm cache-hit rate, target resolution/FPS, scene type, font availability, Chromium revision, FFmpeg encoder, and whether another workload is using the GPU. Record G-Helper/Windows power mode and boost state. Do not change the user's power profile without approval, and do not compare silent-mode output with an unlabeled peak benchmark.

## Render differs between preview and export

Capture the compiled scene hash, target layout, renderer/Chromium/font revisions, deterministic seed, tick/frame, device scale, and asset hashes. Remote assets, host fonts, wall clock, autonomous CSS animation, and unseeded randomness are defects. The same scene component and compiled target must drive both paths.

## Captions overlap or text is clipped

Run the target-specific layout and accessibility checks. Portrait and square targets must be recompiled rather than cropped. Inspect font/glyph availability, caption exclusion zones, reading rate, line breaking, essential visuals, and reduced-motion layout. A screenshot is required before closing a visual defect.

## Cloud request is blocked

Common reasons are absent credential, unapproved provider or payload class, stale retention/pricing metadata, unknown upper-bound cost, exceeded budget, region mismatch, or Fully Local mode. The remedy is an explicit configuration or approval—not a silent alternate provider.

## Export is blocked by rights or consent

Open the provenance report and resolve every asset with unknown/restricted rights, missing attribution, expired terms, or missing/revoked consent. Removing a required credit or bypassing a consent record is not a supported workaround.

## Project is on OneDrive, SMB, or another sync/network path

Open it read-only or create a verified local working copy. Live SQLite/WAL editing on filesystems with uncertain locking and atomicity is unsupported. Use `.alytutorial` archives for intentional transfer.

## Safe diagnostics sharing

Preview the bundle before saving. It should contain versions, capability results, hashes, status codes, redacted events, and performance metadata—not project content, prompts, raw URLs, credentials, source text, or provider responses. If a secret canary appears, stop and report a security defect.
