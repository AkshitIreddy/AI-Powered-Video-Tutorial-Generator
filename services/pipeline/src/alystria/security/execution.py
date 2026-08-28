"""Safe construction of subprocess invocations.

This module never starts a process.  The privileged broker consumes only a
``ValidatedCommand`` and must call subprocess APIs with ``shell=False``.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from .errors import PolicyViolation, ValidationError


@dataclass(frozen=True, slots=True)
class CommandPolicy:
    allowed_executables: frozenset[str]
    trusted_executable_roots: tuple[Path, ...]
    allowed_environment: frozenset[str] = frozenset({"PATH", "TEMP", "TMP", "SYSTEMROOT"})
    max_arguments: int = 512
    max_argument_bytes: int = 32 * 1024
    allow_response_files: bool = False


@dataclass(frozen=True, slots=True)
class ValidatedCommand:
    executable: Path
    arguments: tuple[str, ...]
    environment: tuple[tuple[str, str], ...]
    shell: bool = False

    @property
    def argv(self) -> tuple[str, ...]:
        return (str(self.executable), *self.arguments)


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_command(
    executable: str | Path,
    arguments: Sequence[str],
    *,
    policy: CommandPolicy,
    environment: Mapping[str, str] | None = None,
) -> ValidatedCommand:
    raw_executable = str(executable)
    if "\x00" in raw_executable:
        raise ValidationError("executable contains NUL")
    candidate = Path(raw_executable)
    if not candidate.is_absolute():
        raise PolicyViolation("executable must be an absolute trusted path")
    resolved = candidate.resolve(strict=False)
    allowed_names = {name.casefold() for name in policy.allowed_executables}
    if resolved.name.casefold() not in allowed_names:
        raise PolicyViolation("executable is not allowlisted")
    roots = tuple(root.resolve(strict=False) for root in policy.trusted_executable_roots)
    if not roots or not any(_is_within(resolved, root) for root in roots):
        raise PolicyViolation("executable is outside trusted runtime roots")
    if len(arguments) > policy.max_arguments:
        raise PolicyViolation("command contains too many arguments")
    clean_arguments: list[str] = []
    for argument in arguments:
        if not isinstance(argument, str):
            raise ValidationError("subprocess arguments must be strings")
        if "\x00" in argument or "\r" in argument or "\n" in argument:
            raise ValidationError("subprocess argument contains NUL or newline")
        if len(argument.encode("utf-8")) > policy.max_argument_bytes:
            raise PolicyViolation("subprocess argument exceeds the size limit")
        if argument.startswith("@") and not policy.allow_response_files:
            raise PolicyViolation("response-file arguments are forbidden")
        clean_arguments.append(argument)
    clean_environment: list[tuple[str, str]] = []
    for key, value in (environment or {}).items():
        normalized_key = key.upper()
        if normalized_key not in policy.allowed_environment:
            raise PolicyViolation(f"environment variable is not allowlisted: {key}")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValidationError("environment variable name is invalid")
        if "\x00" in value:
            raise ValidationError("environment variable contains NUL")
        clean_environment.append((normalized_key, value))
    return ValidatedCommand(resolved, tuple(clean_arguments), tuple(sorted(clean_environment)))


def validate_sandbox_path(
    path: str | Path, *, roots: Sequence[Path], must_exist: bool = False
) -> Path:
    """Resolve an input/output path under an attempt-specific staging root."""
    raw = str(path)
    if "\x00" in raw:
        raise ValidationError("sandbox path contains NUL")
    candidate = Path(raw)
    if not candidate.is_absolute():
        raise PolicyViolation("sandbox path must be absolute")
    resolved = candidate.resolve(strict=must_exist)
    trusted_roots = tuple(root.resolve(strict=False) for root in roots)
    if not trusted_roots or not any(_is_within(resolved, root) for root in trusted_roots):
        raise PolicyViolation("sandbox path escapes the staging roots")
    return resolved
