"""Strict decoders for untrusted runtime output."""

from __future__ import annotations

import base64
import binascii
import json
import math
from pathlib import Path

from .errors import SandboxPolicyError, SandboxProtocolError
from .models import (
    JsonScalar,
    JsonValue,
    SandboxOutput,
    SandboxRequest,
    TraceEvent,
    TraceKind,
    ensure_json_value,
)

TRACE_PREFIX = "\x1eALYSTRIA_TRACE "


def decode_worker_result(
    path: Path, request: SandboxRequest
) -> tuple[str, str, JsonValue, tuple[TraceEvent, ...], tuple[SandboxOutput, ...], bool]:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise SandboxProtocolError(f"sandbox worker did not produce a result: {error}") from error
    maximum = request.limits.output_bytes + 1_048_576
    if size > maximum:
        raise SandboxProtocolError("sandbox worker result envelope exceeds its limit")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SandboxProtocolError(f"sandbox worker result is invalid: {error}") from error
    if not isinstance(payload, dict) or payload.get("protocolVersion") != 1:
        raise SandboxProtocolError("sandbox worker protocol version is invalid")
    stdout = _bounded_text(payload.get("stdout"), request.limits.output_bytes, "stdout")
    stderr = _bounded_text(payload.get("stderr"), request.limits.output_bytes, "stderr")
    value = ensure_json_value(payload.get("value"), maximum_bytes=request.limits.output_bytes)
    trace = _decode_trace(payload.get("trace"), request)
    outputs = _decode_outputs(payload.get("outputs"), request)
    validate_aggregate_output(request, stdout, stderr, value, trace, outputs)
    succeeded = payload.get("ok") is True
    if payload.get("ok") not in {True, False}:
        raise SandboxProtocolError("sandbox worker completion state is invalid")
    return stdout, stderr, value, trace, outputs, succeeded


def decode_wasi_streams(
    stdout_bytes: bytes, stderr_bytes: bytes, request: SandboxRequest
) -> tuple[str, str, tuple[TraceEvent, ...]]:
    stdout_lines, stdout_trace = _split_trace(stdout_bytes.decode("utf-8", "replace"), request)
    stderr_lines, stderr_trace = _split_trace(stderr_bytes.decode("utf-8", "replace"), request)
    combined = (*stdout_trace, *stderr_trace)
    trace = tuple(
        TraceEvent(
            index,
            event.kind,
            event.message,
            event.line,
            event.column,
            event.variables,
        )
        for index, event in enumerate(combined)
    )
    return stdout_lines, stderr_lines, trace


def collect_output_directory(directory: Path, request: SandboxRequest) -> tuple[SandboxOutput, ...]:
    outputs: list[SandboxOutput] = []
    total = 0
    root = directory.resolve(strict=True)
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise SandboxProtocolError("sandbox output contains a symbolic link")
        if path.is_dir():
            continue
        if not path.is_file():
            raise SandboxProtocolError("sandbox output contains a non-regular file")
        try:
            relative = path.resolve(strict=True).relative_to(root).as_posix()
        except ValueError as error:
            raise SandboxProtocolError("sandbox output escaped its staging directory") from error
        content = path.read_bytes()
        total += len(content)
        if len(outputs) >= request.limits.max_output_files:
            raise SandboxProtocolError("sandbox produced too many output files")
        if total > request.limits.output_bytes:
            raise SandboxProtocolError("sandbox output files exceed their aggregate limit")
        outputs.append(SandboxOutput(relative, content))
    return tuple(outputs)


def validate_aggregate_output(
    request: SandboxRequest,
    stdout: str,
    stderr: str,
    value: JsonValue,
    trace: tuple[TraceEvent, ...],
    outputs: tuple[SandboxOutput, ...],
) -> None:
    trace_payload = (
        {
            "kind": event.kind.value,
            "message": event.message,
            "line": event.line,
            "column": event.column,
            "variables": dict(event.variables),
        }
        for event in trace
    )
    total = (
        len(stdout.encode("utf-8"))
        + len(stderr.encode("utf-8"))
        + (
            len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))
            if value is not None
            else 0
        )
        + sum(
            len(json.dumps(event, ensure_ascii=False, allow_nan=False).encode("utf-8"))
            for event in trace_payload
        )
        + sum(len(item.content) for item in outputs)
    )
    if total > request.limits.output_bytes:
        raise SandboxProtocolError("aggregate sandbox output exceeds its limit")


def _bounded_text(value: object, maximum: int, label: str) -> str:
    if not isinstance(value, str):
        raise SandboxProtocolError(f"sandbox {label} is not text")
    if len(value.encode("utf-8")) > maximum:
        raise SandboxProtocolError(f"sandbox {label} exceeds its limit")
    return value


def _decode_trace(value: object, request: SandboxRequest) -> tuple[TraceEvent, ...]:
    if not isinstance(value, list):
        raise SandboxProtocolError("sandbox trace is not an array")
    if len(value) > request.limits.max_trace_events:
        raise SandboxProtocolError("sandbox trace has too many events")
    return tuple(_event(item, sequence=index) for index, item in enumerate(value))


def _event(value: object, *, sequence: int) -> TraceEvent:
    if not isinstance(value, dict):
        raise SandboxProtocolError("sandbox trace event is not an object")
    try:
        kind = TraceKind(str(value.get("kind", "custom")))
    except ValueError:
        kind = TraceKind.CUSTOM
    message = value.get("message", "")
    if not isinstance(message, str) or len(message.encode("utf-8")) > 16_384:
        raise SandboxProtocolError("sandbox trace message is invalid")
    line = value.get("line")
    column = value.get("column")
    if line is not None and (not isinstance(line, int) or isinstance(line, bool)):
        raise SandboxProtocolError("sandbox trace line is invalid")
    if column is not None and (not isinstance(column, int) or isinstance(column, bool)):
        raise SandboxProtocolError("sandbox trace column is invalid")
    variables_value = value.get("variables", {})
    if not isinstance(variables_value, dict):
        raise SandboxProtocolError("sandbox trace variables are invalid")
    if len(variables_value) > 256:
        raise SandboxProtocolError("sandbox trace contains too many variables")
    variables: list[tuple[str, JsonScalar]] = []
    for key, item in sorted(variables_value.items()):
        if not isinstance(key, str) or not isinstance(item, str | int | float | bool | type(None)):
            raise SandboxProtocolError("sandbox trace variable is not scalar")
        if len(key.encode("utf-8")) > 256:
            raise SandboxProtocolError("sandbox trace variable name is too large")
        if isinstance(item, str) and len(item.encode("utf-8")) > 4_096:
            raise SandboxProtocolError("sandbox trace variable value is too large")
        if isinstance(item, float) and not math.isfinite(item):
            raise SandboxProtocolError("sandbox trace contains a non-finite number")
        variables.append((key, item))
    return TraceEvent(sequence, kind, message, line, column, tuple(variables))


def _decode_outputs(value: object, request: SandboxRequest) -> tuple[SandboxOutput, ...]:
    if not isinstance(value, list):
        raise SandboxProtocolError("sandbox outputs are not an array")
    if len(value) > request.limits.max_output_files:
        raise SandboxProtocolError("sandbox produced too many output files")
    outputs: list[SandboxOutput] = []
    total = 0
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise SandboxProtocolError("sandbox output descriptor is invalid")
        encoded = item.get("content")
        if not isinstance(encoded, str):
            raise SandboxProtocolError("sandbox output content is invalid")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as error:
            raise SandboxProtocolError("sandbox output is not valid base64") from error
        total += len(content)
        if total > request.limits.output_bytes:
            raise SandboxProtocolError("sandbox output files exceed their aggregate limit")
        try:
            outputs.append(SandboxOutput(item["path"], content))
        except SandboxPolicyError as error:
            raise SandboxProtocolError(str(error)) from error
    return tuple(outputs)


def _split_trace(text: str, request: SandboxRequest) -> tuple[str, tuple[TraceEvent, ...]]:
    ordinary: list[str] = []
    events: list[TraceEvent] = []
    # str.splitlines treats ASCII record-separator (our prefix) as a line break.
    # Split only on LF so the marker remains available for recognition.
    lines = text.split("\n")
    for index, raw_line in enumerate(lines):
        line = raw_line + ("\n" if index < len(lines) - 1 else "")
        stripped = raw_line.rstrip("\r")
        if not stripped.startswith(TRACE_PREFIX):
            ordinary.append(line)
            continue
        if len(events) >= request.limits.max_trace_events:
            raise SandboxProtocolError("WASI trace has too many events")
        try:
            raw = json.loads(stripped[len(TRACE_PREFIX) :])
        except json.JSONDecodeError as error:
            raise SandboxProtocolError("WASI emitted a malformed trace event") from error
        events.append(_event(raw, sequence=len(events)))
    return "".join(ordinary), tuple(events)
