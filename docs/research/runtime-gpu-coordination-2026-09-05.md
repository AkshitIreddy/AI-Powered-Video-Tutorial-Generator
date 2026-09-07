# Local GPU ownership audit

The native acceptance review found that presenter `gpuLease` fields were only
validated metadata. They did not acquire the declared mutex or the owner's
shared `gpu use.txt` marker. The ComfyUI launcher checked and wrote the marker
in separate unlocked operations. Either route could overlap another model run.

The pipeline now acquires an operating-system guard immediately around the
presenter worker invocation. Runtime hashing, input staging, encoder selection,
completed-artifact reuse, output probing, narration, and CPU alignment stay
outside that lease. ComfyUI holds the same guard while its model process is
alive. Both routes share one Windows mutex; presenters also acquire their
declared runtime mutex.

The desktop forwards `ALYSTRIA_GPU_LOCK_PATH` when an existing shared marker is
configured. A missing or malformed explicit marker is an error. With no explicit
marker, the guard creates an app-owned marker once under `ALYSTRIA_TEMP_DIR`.
It never replaces an existing claim. On Windows, the marker handle permits
readers while denying other writers and rename/delete access, so checking `no`
and writing `yes` happen under actual exclusive ownership. This uses Microsoft's
[CreateFileW sharing contract](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
Windows mutex ownership belongs to the acquiring thread; even an abandoned
mutex requires checking the marker before proceeding. See Microsoft's
[mutex documentation](https://learn.microsoft.com/en-us/windows/win32/sync/mutex-objects).

Normal completion, confirmed cancellation, and ordinary failures release the
owned marker to `no`. If child-process shutdown cannot be confirmed, the marker
remains `yes`. Abrupt process termination also leaves a conservative claim;
recovery must verify that the previous workload stopped before clearing it.
An unsuccessful acquisition never clears someone else's claim. POSIX uses an
advisory file lock; its named-mutex fallback is process-local, unlike Windows.

Tests use temporary markers and CPU-only fake presenter/ComfyUI workers. They
exercise real competing processes, readable held claims, acquisition failure,
normal release, abrupt exit, unknown marker contents, indirect paths, and
retention when process survival is unresolved. Native inference qualification
is recorded separately in the Windows integration audit; these checks do not
claim a completed presenter generation.

On 2026-09-07, the combined guard, ComfyUI, and local-presenter suites passed
44 tests in 29.29 seconds on Windows. Ruff passed for the six changed files,
and strict mypy passed for the three changed source modules. Source checkpoint:
`969720c`. No model inference or provider call was used for these checks.
