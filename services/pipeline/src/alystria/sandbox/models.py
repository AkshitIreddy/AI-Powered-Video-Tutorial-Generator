"""Immutable contracts for deterministic, capability-limited code execution."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import PurePosixPath

from .errors import SandboxPolicyError

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]


class RuntimeKind(StrEnum):
    WASMTIME_WASI = "wasmtime-wasi"
    PYODIDE = "pyodide"
    QUICKJS_WASM = "quickjs-wasm"


class ExecutionStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMED_OUT = "timed-out"
    CANCELLED = "cancelled"
    RESOURCE_EXHAUSTED = "resource-exhausted"
    UNAVAILABLE = "unavailable"
    POLICY_VIOLATION = "policy-violation"
    RUNTIME_ERROR = "runtime-error"


class TraceKind(StrEnum):
    CALL = "call"
    LINE = "line"
    RETURN = "return"
    VARIABLE = "variable"
    STDOUT = "stdout"
    STDERR = "stderr"
    RESULT = "result"
    ERROR = "error"
    CUSTOM = "custom"


@dataclass(frozen=True, slots=True)
class ExecutionLimits:
    """Hard outer bounds; callers may reduce but never disable them."""

    wall_time_ms: int = 2_000
    cpu_time_ms: int = 1_500
    memory_bytes: int = 256 * 1024 * 1024
    output_bytes: int = 1 * 1024 * 1024
    input_bytes: int = 4 * 1024 * 1024
    max_output_files: int = 32
    max_trace_events: int = 5_000
    max_processes: int = 1

    def __post_init__(self) -> None:
        ranges = {
            "wall_time_ms": (self.wall_time_ms, 10, 60_000),
            "cpu_time_ms": (self.cpu_time_ms, 10, 60_000),
            "memory_bytes": (self.memory_bytes, 16 * 1024 * 1024, 2 * 1024**3),
            "output_bytes": (self.output_bytes, 1, 64 * 1024 * 1024),
            "input_bytes": (self.input_bytes, 0, 64 * 1024 * 1024),
            "max_output_files": (self.max_output_files, 0, 256),
            "max_trace_events": (self.max_trace_events, 0, 100_000),
        }
        for name, (value, minimum, maximum) in ranges.items():
            if not minimum <= value <= maximum:
                raise SandboxPolicyError(f"{name} must be between {minimum} and {maximum}")
        if self.max_processes != 1:
            raise SandboxPolicyError("sandbox process count is fixed at one")


def _validate_guest_path(value: str) -> str:
    if not value or "\x00" in value or "\\" in value:
        raise SandboxPolicyError("guest paths must be non-empty portable POSIX paths")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SandboxPolicyError("guest paths must be normalized relative paths")
    if len(value.encode("utf-8")) > 512:
        raise SandboxPolicyError("guest path exceeds 512 UTF-8 bytes")
    return path.as_posix()


@dataclass(frozen=True, slots=True)
class SandboxInput:
    path: str
    content: bytes

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", _validate_guest_path(self.path))


@dataclass(frozen=True, slots=True)
class SandboxRequest:
    runtime: RuntimeKind
    source: str | None = None
    module: bytes | None = None
    inputs: tuple[SandboxInput, ...] = ()
    stdin: bytes = b""
    arguments: tuple[str, ...] = ()
    seed: int = 0
    locale: str = "C.UTF-8"
    timezone: str = "UTC"
    limits: ExecutionLimits = field(default_factory=ExecutionLimits)

    def __post_init__(self) -> None:
        if self.runtime is RuntimeKind.WASMTIME_WASI:
            if not self.module or self.source is not None:
                raise SandboxPolicyError("WASI execution requires module bytes and no source")
            if not self.module.startswith(b"\x00asm"):
                raise SandboxPolicyError("WASI module does not have the WebAssembly magic header")
        elif self.source is None or self.module is not None:
            raise SandboxPolicyError("source runtimes require source text and no module bytes")
        if self.source is not None and len(self.source.encode("utf-8")) > self.limits.input_bytes:
            raise SandboxPolicyError("source exceeds the sandbox input limit")
        total_input = len(self.stdin) + len(self.module or b"")
        seen: set[str] = set()
        for item in self.inputs:
            if item.path in seen:
                raise SandboxPolicyError(f"duplicate sandbox input path: {item.path}")
            seen.add(item.path)
            total_input += len(item.content)
        if total_input > self.limits.input_bytes:
            raise SandboxPolicyError("sandbox inputs exceed the aggregate input limit")
        if not 0 <= self.seed <= 0xFFFFFFFF:
            raise SandboxPolicyError("seed must fit in an unsigned 32-bit integer")
        if self.timezone != "UTC":
            raise SandboxPolicyError("sandbox timezone is fixed at UTC for deterministic execution")
        if self.locale != "C.UTF-8":
            raise SandboxPolicyError("sandbox locale is fixed at C.UTF-8 for deterministic execution")
        if len(self.arguments) > 64:
            raise SandboxPolicyError("sandbox accepts at most 64 guest arguments")
        for argument in self.arguments:
            if "\x00" in argument or len(argument.encode("utf-8")) > 4_096:
                raise SandboxPolicyError("guest argument is invalid or too large")


@dataclass(frozen=True, slots=True)
class TraceEvent:
    sequence: int
    kind: TraceKind
    message: str = ""
    line: int | None = None
    column: int | None = None
    variables: tuple[tuple[str, JsonScalar], ...] = ()

    def __post_init__(self) -> None:
        if self.sequence < 0:
            raise SandboxPolicyError("trace sequence cannot be negative")
        if self.line is not None and self.line < 1:
            raise SandboxPolicyError("trace line must be positive")
        if self.column is not None and self.column < 1:
            raise SandboxPolicyError("trace column must be positive")


@dataclass(frozen=True, slots=True)
class SandboxOutput:
    path: str
    content: bytes
    sha256: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "path", _validate_guest_path(self.path))
        object.__setattr__(self, "sha256", hashlib.sha256(self.content).hexdigest())


@dataclass(frozen=True, slots=True)
class RuntimeDiagnostic:
    runtime: RuntimeKind
    available: bool
    version: str | None
    issues: tuple[str, ...] = ()
    capabilities: tuple[str, ...] = (
        "no-network",
        "read-only-inputs",
        "ephemeral-outputs",
        "bounded-resources",
        "process-tree-cancellation",
    )


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    runtime: RuntimeKind
    status: ExecutionStatus
    stdout: str = ""
    stderr: str = ""
    value: JsonValue = None
    trace: tuple[TraceEvent, ...] = ()
    outputs: tuple[SandboxOutput, ...] = ()
    exit_code: int | None = None
    duration_ms: int = 0
    diagnostics: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status is ExecutionStatus.SUCCEEDED

    def to_dict(self, *, include_output_content: bool = False) -> dict[str, JsonValue]:
        outputs: list[JsonValue] = []
        for output in self.outputs:
            item: dict[str, JsonValue] = {
                "path": output.path,
                "size": len(output.content),
                "sha256": output.sha256,
            }
            if include_output_content:
                item["contentHex"] = output.content.hex()
            outputs.append(item)
        return {
            "runtime": self.runtime.value,
            "status": self.status.value,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "value": self.value,
            "trace": [
                {
                    "sequence": event.sequence,
                    "kind": event.kind.value,
                    "message": event.message,
                    "line": event.line,
                    "column": event.column,
                    "variables": dict(event.variables),
                }
                for event in self.trace
            ],
            "outputs": outputs,
            "exitCode": self.exit_code,
            "durationMs": self.duration_ms,
            "diagnostics": list(self.diagnostics),
        }


def ensure_json_value(value: object, *, maximum_bytes: int) -> JsonValue:
    """Validate and normalize a worker value without accepting custom objects."""

    def normalize(item: object, depth: int = 0) -> JsonValue:
        if depth > 32:
            raise SandboxPolicyError("sandbox result nesting exceeds 32 levels")
        if isinstance(item, float) and not math.isfinite(item):
            raise SandboxPolicyError("sandbox result contains a non-finite number")
        if item is None or isinstance(item, str | bool | int | float):
            return item
        if isinstance(item, list):
            return [normalize(child, depth + 1) for child in item]
        if isinstance(item, dict) and all(isinstance(key, str) for key in item):
            return {str(key): normalize(child, depth + 1) for key, child in item.items()}
        raise SandboxPolicyError("sandbox result is not JSON-compatible")

    normalized = normalize(value)
    encoded = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    if len(encoded) > maximum_bytes:
        raise SandboxPolicyError("sandbox result exceeds the output limit")
    return normalized


_VERSION_PATTERN = re.compile(r"(?<!\d)(\d+)\.(\d+)(?:\.(\d+))?")


def parse_version(value: str) -> tuple[int, int, int] | None:
    match = _VERSION_PATTERN.search(value)
    if match is None:
        return None
    major, minor, patch = (int(part or 0) for part in match.groups())
    return major, minor, patch
