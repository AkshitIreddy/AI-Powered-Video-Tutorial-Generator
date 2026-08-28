"""Coordinator for isolated code execution attempts."""

from __future__ import annotations

import contextlib
import stat
import tempfile
import threading
from pathlib import Path

from .adapters import (
    AttemptWorkspace,
    ExecutableSpec,
    JavaScriptBundle,
    PyodideAdapter,
    QuickJsWasmAdapter,
    SandboxAdapter,
    WasmtimeWasiAdapter,
)
from .errors import SandboxPolicyError, SandboxProtocolError
from .models import (
    ExecutionResult,
    ExecutionStatus,
    RuntimeDiagnostic,
    RuntimeKind,
    SandboxRequest,
)
from .process import ProcessRunner, SubprocessRunner, TerminationReason
from .protocol import (
    collect_output_directory,
    decode_wasi_streams,
    decode_worker_result,
    validate_aggregate_output,
)


class SandboxExecutor:
    """Fail-closed runtime router with no host-language evaluation fallback."""

    def __init__(
        self,
        adapters: tuple[SandboxAdapter, ...],
        *,
        runner: ProcessRunner | None = None,
        temporary_root: Path | None = None,
    ) -> None:
        self._adapters = {adapter.runtime: adapter for adapter in adapters}
        if len(self._adapters) != len(adapters):
            raise ValueError("sandbox runtime adapters must be unique")
        self._runner = runner or SubprocessRunner()
        self._temporary_root = temporary_root

    def diagnose(self) -> tuple[RuntimeDiagnostic, ...]:
        diagnostics: list[RuntimeDiagnostic] = []
        for runtime in RuntimeKind:
            adapter = self._adapters.get(runtime)
            if adapter is None:
                diagnostics.append(
                    RuntimeDiagnostic(runtime, False, None, ("runtime adapter is not configured",))
                )
            else:
                diagnostics.append(adapter.diagnose(self._runner))
        return tuple(diagnostics)

    def execute(
        self, request: SandboxRequest, *, cancellation: threading.Event | None = None
    ) -> ExecutionResult:
        if cancellation is not None and cancellation.is_set():
            return ExecutionResult(request.runtime, ExecutionStatus.CANCELLED)
        adapter = self._adapters.get(request.runtime)
        if adapter is None:
            return ExecutionResult(
                request.runtime,
                ExecutionStatus.UNAVAILABLE,
                diagnostics=("runtime adapter is not configured",),
            )
        diagnostic = adapter.diagnose(self._runner)
        if not diagnostic.available:
            return ExecutionResult(
                request.runtime,
                ExecutionStatus.UNAVAILABLE,
                diagnostics=diagnostic.issues,
            )
        temporary_parent = str(self._temporary_root) if self._temporary_root else None
        with tempfile.TemporaryDirectory(prefix="alystria-sandbox-", dir=temporary_parent) as raw:
            workspace = _prepare_workspace(Path(raw), request)
            try:
                plan = adapter.prepare(request, workspace)
            except (OSError, SandboxPolicyError) as error:
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.POLICY_VIOLATION,
                    diagnostics=(str(error),),
                )
            try:
                raw_result = self._runner.run(plan, cancellation=cancellation)
            finally:
                restore_write_permission(workspace.inputs)
            if raw_result.reason is TerminationReason.CANCELLED:
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.CANCELLED,
                    duration_ms=raw_result.duration_ms,
                )
            if raw_result.reason is TerminationReason.TIMED_OUT:
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.TIMED_OUT,
                    duration_ms=raw_result.duration_ms,
                    diagnostics=("sandbox exceeded its wall-time limit",),
                )
            if raw_result.reason is TerminationReason.OUTPUT_LIMIT:
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.RESOURCE_EXHAUSTED,
                    duration_ms=raw_result.duration_ms,
                    diagnostics=("sandbox exceeded its process-output limit",),
                )
            if raw_result.reason is TerminationReason.START_FAILED:
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.UNAVAILABLE,
                    duration_ms=raw_result.duration_ms,
                    diagnostics=(raw_result.start_error or "sandbox process could not start",),
                )
            try:
                if request.runtime is RuntimeKind.WASMTIME_WASI:
                    stdout, stderr, trace = decode_wasi_streams(
                        raw_result.stdout, raw_result.stderr, request
                    )
                    outputs = collect_output_directory(workspace.outputs, request)
                    validate_aggregate_output(request, stdout, stderr, None, trace, outputs)
                    status = (
                        ExecutionStatus.SUCCEEDED
                        if raw_result.returncode == 0
                        else ExecutionStatus.FAILED
                    )
                    return ExecutionResult(
                        request.runtime,
                        status,
                        stdout=stdout,
                        stderr=stderr,
                        trace=trace,
                        outputs=outputs,
                        exit_code=raw_result.returncode,
                        duration_ms=raw_result.duration_ms,
                    )
                if plan.result_path is None:
                    raise SandboxProtocolError("sandbox worker result path is missing")
                if raw_result.returncode != 0:
                    return ExecutionResult(
                        request.runtime,
                        ExecutionStatus.RUNTIME_ERROR,
                        stderr=_outer_error(raw_result.stderr),
                        exit_code=raw_result.returncode,
                        duration_ms=raw_result.duration_ms,
                        diagnostics=("trusted sandbox worker exited unexpectedly",),
                    )
                stdout, stderr, value, trace, outputs, succeeded = decode_worker_result(
                    plan.result_path, request
                )
                return ExecutionResult(
                    request.runtime,
                    ExecutionStatus.SUCCEEDED if succeeded else ExecutionStatus.FAILED,
                    stdout=stdout,
                    stderr=stderr,
                    value=value,
                    trace=trace,
                    outputs=outputs,
                    exit_code=raw_result.returncode,
                    duration_ms=raw_result.duration_ms,
                )
            except (OSError, SandboxPolicyError, SandboxProtocolError) as error:
                status = (
                    ExecutionStatus.RESOURCE_EXHAUSTED
                    if "limit" in str(error).casefold() or "too many" in str(error).casefold()
                    else ExecutionStatus.RUNTIME_ERROR
                )
                return ExecutionResult(
                    request.runtime,
                    status,
                    exit_code=raw_result.returncode,
                    duration_ms=raw_result.duration_ms,
                    diagnostics=(str(error),),
                )


def executor_from_runtime_root(
    runtime_root: Path,
    *,
    runner: ProcessRunner | None = None,
    temporary_root: Path | None = None,
) -> SandboxExecutor:
    """Build adapters only from an application-managed, trusted runtime root.

    The host PATH is deliberately ignored. Runtime installation and signature
    verification belong to the privileged runtime manager.
    """

    root = runtime_root.resolve(strict=False)
    node_path = _first_existing(
        root / "node" / "node.exe",
        root / "node" / "bin" / "node",
        root / "node.exe",
        root / "node",
    )
    wasmtime_path = _first_existing(
        root / "wasmtime" / "wasmtime.exe",
        root / "wasmtime" / "bin" / "wasmtime",
        root / "wasmtime.exe",
        root / "wasmtime",
    )
    node = (
        ExecutableSpec(node_path, (root,), frozenset({"node", "node.exe"}), 24)
        if node_path
        else None
    )
    wasmtime = (
        ExecutableSpec(wasmtime_path, (root,), frozenset({"wasmtime", "wasmtime.exe"}), 28)
        if wasmtime_path
        else None
    )
    pyodide_module = _first_existing(
        root / "pyodide" / "pyodide.mjs", root / "pyodide" / "pyodide.js"
    )
    quickjs_module = _first_existing(
        root / "quickjs" / "quickjs-emscripten.mjs",
        root / "quickjs" / "index.mjs",
        root / "quickjs" / "index.js",
    )
    pyodide_bundle = (
        JavaScriptBundle(node, pyodide_module, root / "pyodide")
        if node is not None and pyodide_module is not None
        else None
    )
    quickjs_bundle = (
        JavaScriptBundle(node, quickjs_module, root / "quickjs")
        if node is not None and quickjs_module is not None
        else None
    )
    return SandboxExecutor(
        (
            WasmtimeWasiAdapter(wasmtime),
            PyodideAdapter(pyodide_bundle),
            QuickJsWasmAdapter(quickjs_bundle),
        ),
        runner=runner,
        temporary_root=temporary_root,
    )


def _first_existing(*paths: Path) -> Path | None:
    return next((path for path in paths if path.is_file()), None)


def _prepare_workspace(root: Path, request: SandboxRequest) -> AttemptWorkspace:
    root.chmod(stat.S_IRWXU)
    inputs = root / "inputs"
    outputs = root / "outputs"
    control = root / "control"
    for directory in (inputs, outputs, control):
        directory.mkdir(mode=0o700)
    for item in request.inputs:
        destination = inputs.joinpath(*item.path.split("/"))
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.write_bytes(item.content)
        destination.chmod(stat.S_IRUSR)
    # WASI receives the host input tree as a preopened directory. Removing write
    # bits from every directory prevents create/rename operations as well as
    # file modification. JS guests receive copies in their own Wasm filesystem.
    for directory in sorted((path for path in inputs.rglob("*") if path.is_dir()), reverse=True):
        directory.chmod(stat.S_IRUSR | stat.S_IXUSR)
    inputs.chmod(stat.S_IRUSR | stat.S_IXUSR)
    outputs.chmod(stat.S_IRWXU)
    control.chmod(stat.S_IRWXU)
    return AttemptWorkspace(root, inputs, outputs, control)


def _outer_error(value: bytes) -> str:
    return value[:16_384].decode("utf-8", "replace")


def restore_write_permission(path: Path) -> None:
    """Best-effort helper for platforms that require write access before cleanup."""

    with contextlib.suppress(OSError):
        path.chmod(stat.S_IRWXU if path.is_dir() else stat.S_IRUSR | stat.S_IWUSR)
    if path.is_dir():
        for child in path.rglob("*"):
            with contextlib.suppress(OSError):
                child.chmod(
                    stat.S_IRWXU if child.is_dir() else stat.S_IRUSR | stat.S_IWUSR
                )
