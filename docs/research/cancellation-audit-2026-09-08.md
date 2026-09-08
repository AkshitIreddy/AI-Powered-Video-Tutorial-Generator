# Native render cancellation audit

September 8, 2026. Current-package cancellation and normal shutdown passed on
desktop source `ea5c935`, worker source `694362f`, and harness `97dd51e`.
No provider generation was used in these tests. Full master/editor qualification
is a separate, still-running acceptance.

The September 7 interrupted export was a failed render with a durable cancel
request, not a successful cancellation. Force-stopping the harness skipped its
cleanup and left worker/renderer processes alive. Preserve that receipt as a
failed attempt; the fixes below do not retroactively qualify it.

## Source corrections

- `056af64`: the job runtime checks durable cancellation when an active handler
  raises. Renderer, budget, and retry exceptions after cancellation now produce
  `CANCELLED`; an ordinary error without cancellation remains `FAILED`.
- `81b7d38`, `8d17455`: a real subprocess integration test requests cancellation
  through a separate SQLite connection. Its descendant variant reproduced the
  Windows orphan: killing only the parent left inherited output pipes open for
  over six seconds. A dedicated Windows Job Object now owns the renderer tree,
  terminates it on cancellation/timeout, and closes it after the operation.
  This is trusted-process cleanup, not adversarial sandbox containment.
- `7c26f73`: native scene and master exports enter the renderer cancellation
  scope and check cancellation before promoting output. Editor FFmpeg uses the
  same cancellable runner; editor export checks before artifact/revision
  promotion. Cancellation does not leak into the next job's scope.
- `fea5b53`: native render task keys and immutable master receipts include the
  verified renderer build identity, preventing an updated renderer from reusing
  the old native job result. Legacy receipts remain readable under their prior
  contract.

The Windows process mechanism follows Microsoft's
[Job Objects documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
The child is assigned immediately after process creation; this is not a claim
of suspended-launch or adversarial process containment.

## Verification boundary

### Integrated September 8 retake

On package `694362f`, actual HEVC master job
`f02fcaa6-fda4-4df4-8aca-825c3b3605cc` ran the renderer and reached `CANCELLED`
at 07:12:25.054 UTC, about three seconds after the stop request. It promoted
no result. The desktop exited with code zero after WM_CLOSE, but the complete
shutdown gate **failed**. CIM could not establish a strong identity for one
descendant; a subsequent independent scan found two new worker processes
created after the close request, parented to the exact closing desktop.

Root recorded their executable paths, creation times, and descendants, then
stopped only those verified workers and their conhost. The sandbox process scan
was empty before releasing its own retained GPU claim. Evidence is preserved in
`E:\temp\avt-final-media-inspection-20260907\native-cancellation-shutdown-race-694362f`
and sibling `native-cancellation-leaked-workers-20260908.json`.

`ce2add4` adds permanent supervisor closure for desktop exit. Ordinary stop
remains restartable; final close rejects subsequent start/restart/ping calls,
including launches still verifying runtime files. Seven Rust sidecar tests
passed, including an in-flight request, concurrent teardown, and late calls.
This source result requires a rebuilt-package retake. The harness must also
retain a complete identity-bound process inventory rather than treating an
empty inventory after a snapshot error as successful cleanup.

The runtime cancellation unit selection passed 14 tests. The renderer suite and
actual subprocess cancellation integration passed 37 tests. The combined
renderer/editor selection passed 49 tests; the final native/editor selection
passed 40 tests. These selections overlap and must not be added together.
Ruff and source mypy checks passed for the modified Python modules.

### Accepted rebuilt-package retake

The same HEVC job was explicitly retried through the native job card. On
attempt 4, the observer saw renderer PID 32752 actively running for more than
five seconds, then requested cooperative stop at 08:08:16.387 UTC. SQLite
persisted `CANCELLED` at 08:08:21.418 UTC with a null result. Desktop PID 6520
closed normally with exit code zero; the receipt captured 18 owned process
identities, no remaining processes, no fallback cleanup, and no problems.
An independent executable-path scan also found no sandbox processes before
GPU ownership returned to `no`.

Evidence: `E:\temp\avt-final-media-inspection-20260907\native-cancellation-accepted-ea5c935`.
The package hashes are:

- Desktop: `01976a5e16fd63d2329a0a07b0bd7224cbea70e3fa6eb0e18b28e5d0496ba518`
- Worker: `aca5806cc6a76298bd1265f87fe76c14faa5f70dead5e38afdfbedabd656c85c`
- Runtime manifest: `98f42c5df52b9f1a685e8b64e7a24e9648256b54d8db114e8324680b39058665`

Attempts 2 and 3 are preserved as failed inventory gates, even though their
jobs cancelled and independent scans found no survivors. Newly born Chromium
children sometimes had incomplete CIM identities. `97dd51e` resolves only the
already enumerated weak rows against one verification snapshot; it does not
chase additional children. Changed, reused, or conflicting identities remain
failures. Sixteen identity/stop-coordinator tests passed before attempt 4.

This accepts the cooperative active-render cancellation path and rebuilt
desktop shutdown. A force kill cannot run JavaScript cleanup and must not be
described as a graceful stop. Full master/editor acceptance remains separate.
