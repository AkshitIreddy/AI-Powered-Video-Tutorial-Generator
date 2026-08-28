"""Runtime-specific command planners.

Adapters only produce invocations for trusted runtime binaries. They never turn
guest source into shell text, command arguments, environment variable names, or
host paths.
"""

from __future__ import annotations

import base64
import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .errors import SandboxPolicyError
from .models import RuntimeDiagnostic, RuntimeKind, SandboxRequest, parse_version
from .process import ProcessLimits, ProcessPlan, ProcessRunner


@dataclass(frozen=True, slots=True)
class AttemptWorkspace:
    root: Path
    inputs: Path
    outputs: Path
    control: Path


@dataclass(frozen=True, slots=True)
class ExecutableSpec:
    path: Path
    trusted_roots: tuple[Path, ...]
    allowed_names: frozenset[str]
    minimum_major: int


@dataclass(frozen=True, slots=True)
class JavaScriptBundle:
    node: ExecutableSpec
    module_path: Path
    runtime_root: Path


class SandboxAdapter(Protocol):
    runtime: RuntimeKind

    def diagnose(self, runner: ProcessRunner) -> RuntimeDiagnostic: ...

    def prepare(self, request: SandboxRequest, workspace: AttemptWorkspace) -> ProcessPlan: ...


def _within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _validate_executable(spec: ExecutableSpec) -> tuple[Path | None, tuple[str, ...]]:
    issues: list[str] = []
    if not spec.path.is_absolute():
        return None, ("runtime executable path is not absolute",)
    try:
        path = spec.path.resolve(strict=True)
    except OSError as error:
        return None, (f"runtime executable is unavailable: {error}",)
    roots = tuple(root.resolve(strict=False) for root in spec.trusted_roots)
    if not roots or not any(_within(path, root) for root in roots):
        issues.append("runtime executable is outside trusted runtime roots")
    if path.name.casefold() not in {name.casefold() for name in spec.allowed_names}:
        issues.append("runtime executable name is not allowlisted")
    if not path.is_file():
        issues.append("runtime executable is not a regular file")
    if os.name != "nt" and not os.access(path, os.X_OK):
        issues.append("runtime executable is not executable")
    return (path if not issues else None), tuple(issues)


def _diagnose_executable(
    runtime: RuntimeKind, spec: ExecutableSpec, runner: ProcessRunner
) -> RuntimeDiagnostic:
    executable, issues = _validate_executable(spec)
    if executable is None:
        return RuntimeDiagnostic(runtime, False, None, issues)
    result = runner.probe(
        (str(executable), "--version"),
        environment={"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC"},
    )
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    version = parse_version(output)
    if result.error is not None:
        return RuntimeDiagnostic(runtime, False, None, (f"version probe failed: {result.error}",))
    if result.returncode != 0:
        return RuntimeDiagnostic(runtime, False, output or None, ("version probe failed",))
    if version is None:
        return RuntimeDiagnostic(runtime, False, output or None, ("runtime version is unparseable",))
    if version[0] < spec.minimum_major:
        return RuntimeDiagnostic(
            runtime,
            False,
            output,
            (f"runtime major {version[0]} is below required {spec.minimum_major}",),
        )
    return RuntimeDiagnostic(runtime, True, output)


def _validate_bundle_path(path: Path, root: Path, label: str) -> tuple[Path | None, str | None]:
    if not path.is_absolute() or not root.is_absolute():
        return None, f"{label} path is not absolute"
    try:
        resolved = path.resolve(strict=True)
        trusted_root = root.resolve(strict=True)
    except OSError as error:
        return None, f"{label} is unavailable: {error}"
    if not _within(resolved, trusted_root) or not resolved.is_file():
        return None, f"{label} is outside its trusted runtime bundle"
    return resolved, None


def _limits(request: SandboxRequest) -> ProcessLimits:
    return ProcessLimits(
        wall_time_ms=request.limits.wall_time_ms,
        cpu_time_ms=request.limits.cpu_time_ms,
        memory_bytes=request.limits.memory_bytes,
        # Leave room for the trusted worker envelope. Guest output is separately
        # checked against the exact request limit by the protocol decoder.
        output_bytes=request.limits.output_bytes + min(1_048_576, request.limits.output_bytes),
    )


def _environment(request: SandboxRequest) -> tuple[tuple[str, str], ...]:
    return (
        ("LANG", request.locale),
        ("LC_ALL", request.locale),
        ("TZ", request.timezone),
        ("SOURCE_DATE_EPOCH", "0"),
        ("PYTHONHASHSEED", str(request.seed)),
    )


def _write_request(request: SandboxRequest, destination: Path, *, module_path: Path) -> None:
    payload = {
        "protocolVersion": 1,
        "source": request.source,
        "stdin": base64.b64encode(request.stdin).decode("ascii"),
        "arguments": list(request.arguments),
        "inputs": [
            {"path": item.path, "content": base64.b64encode(item.content).decode("ascii")}
            for item in request.inputs
        ],
        "seed": request.seed,
        "locale": request.locale,
        "timezone": request.timezone,
        "limits": {
            "outputBytes": request.limits.output_bytes,
            "maxOutputFiles": request.limits.max_output_files,
            "maxTraceEvents": request.limits.max_trace_events,
            "wallTimeMs": request.limits.wall_time_ms,
            "memoryBytes": request.limits.memory_bytes,
        },
        "runtimeModule": module_path.as_uri(),
    }
    destination.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    destination.chmod(stat.S_IRUSR)


def _node_permission_arguments(
    *, node: Path, worker: Path, request_path: Path, result_path: Path, runtime_root: Path
) -> tuple[str, ...]:
    # Node's permission model denies child_process, worker_threads, native
    # addons, WASI and inspector unless explicitly allowed. No such permissions
    # are granted here. Network safety does not depend on Node permissions: the
    # QuickJS guest receives no network host functions, and the Pyodide worker
    # removes JS bridges before guest imports execute.
    return (
        str(node),
        "--permission",
        "--disable-proto=throw",
        "--no-addons",
        f"--allow-fs-read={worker}",
        f"--allow-fs-read={request_path}",
        f"--allow-fs-read={runtime_root}",
        f"--allow-fs-write={result_path}",
        str(worker),
        str(request_path),
        str(result_path),
    )


class WasmtimeWasiAdapter:
    runtime = RuntimeKind.WASMTIME_WASI

    def __init__(self, executable: ExecutableSpec | None) -> None:
        self._executable = executable

    def diagnose(self, runner: ProcessRunner) -> RuntimeDiagnostic:
        if self._executable is None:
            return RuntimeDiagnostic(self.runtime, False, None, ("Wasmtime is not configured",))
        return _diagnose_executable(self.runtime, self._executable, runner)

    def prepare(self, request: SandboxRequest, workspace: AttemptWorkspace) -> ProcessPlan:
        if self._executable is None:
            raise SandboxPolicyError("Wasmtime is not configured")
        executable, issues = _validate_executable(self._executable)
        if executable is None:
            raise SandboxPolicyError("; ".join(issues))
        module_path = workspace.control / "program.wasm"
        assert request.module is not None
        module_path.write_bytes(request.module)
        module_path.chmod(stat.S_IRUSR)
        argv = (
            str(executable),
            "run",
            f"--dir={workspace.inputs}::/inputs",
            f"--dir={workspace.outputs}::/outputs",
            f"--env=LANG={request.locale}",
            f"--env=LC_ALL={request.locale}",
            f"--env=TZ={request.timezone}",
            f"--env=ALYSTRIA_SEED={request.seed}",
            str(module_path),
            "--",
            *request.arguments,
        )
        return ProcessPlan(argv, _environment(request), workspace.root, _limits(request))


class _NodeWorkerAdapter:
    runtime: RuntimeKind
    worker_name: str

    def __init__(self, bundle: JavaScriptBundle | None) -> None:
        self._bundle = bundle

    @property
    def _worker(self) -> Path:
        return Path(__file__).parent / "workers" / self.worker_name

    def diagnose(self, runner: ProcessRunner) -> RuntimeDiagnostic:
        if self._bundle is None:
            return RuntimeDiagnostic(self.runtime, False, None, ("runtime bundle is not configured",))
        node_diagnostic = _diagnose_executable(self.runtime, self._bundle.node, runner)
        issues = list(node_diagnostic.issues)
        _, module_issue = _validate_bundle_path(
            self._bundle.module_path, self._bundle.runtime_root, "runtime module"
        )
        if module_issue:
            issues.append(module_issue)
        worker = self._worker.resolve(strict=False)
        if not worker.is_file():
            issues.append("packaged sandbox worker is missing")
        return RuntimeDiagnostic(
            self.runtime,
            node_diagnostic.available and not issues,
            node_diagnostic.version,
            tuple(issues),
        )

    def prepare(self, request: SandboxRequest, workspace: AttemptWorkspace) -> ProcessPlan:
        if self._bundle is None:
            raise SandboxPolicyError("runtime bundle is not configured")
        node, node_issues = _validate_executable(self._bundle.node)
        module, module_issue = _validate_bundle_path(
            self._bundle.module_path, self._bundle.runtime_root, "runtime module"
        )
        if node is None or module is None:
            issues = [*node_issues, *([module_issue] if module_issue else [])]
            raise SandboxPolicyError("; ".join(issues))
        worker = self._worker.resolve(strict=True)
        request_path = workspace.control / "request.json"
        result_path = workspace.control / "result.json"
        _write_request(request, request_path, module_path=module)
        argv = _node_permission_arguments(
            node=node,
            worker=worker,
            request_path=request_path,
            result_path=result_path,
            runtime_root=self._bundle.runtime_root.resolve(strict=True),
        )
        return ProcessPlan(
            argv,
            _environment(request),
            workspace.root,
            _limits(request),
            result_path=result_path,
            result_bytes=request.limits.output_bytes + 1_048_576,
        )


class PyodideAdapter(_NodeWorkerAdapter):
    runtime = RuntimeKind.PYODIDE
    worker_name = "pyodide_worker.mjs"


class QuickJsWasmAdapter(_NodeWorkerAdapter):
    runtime = RuntimeKind.QUICKJS_WASM
    worker_name = "quickjs_worker.mjs"
