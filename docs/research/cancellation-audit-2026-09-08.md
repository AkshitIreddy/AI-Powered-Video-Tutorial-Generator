# Native render cancellation audit

September 8, 2026. Source fixes are committed on local `main`; current-package
acceptance remains pending. No provider generation was used in these tests.

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

The runtime cancellation unit selection passed 14 tests. The renderer suite and
actual subprocess cancellation integration passed 37 tests. The combined
renderer/editor selection passed 49 tests; the final native/editor selection
passed 40 tests. These selections overlap and must not be added together.
Ruff and source mypy checks passed for the modified Python modules.

Still required: package these sources; cancel an active real packaged render;
verify `CANCELLED`, no promoted output, normal `WM_CLOSE`, and absence of the
exact owned process tree. Then complete the full master/editor acceptance.
The cooperative harness stop path is separately under review. A force kill
cannot run JavaScript cleanup and must not be described as a graceful stop.
