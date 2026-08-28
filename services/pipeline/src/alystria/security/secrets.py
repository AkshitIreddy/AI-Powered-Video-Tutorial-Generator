"""Secret references and deterministic redaction for logs/diagnostics."""

from __future__ import annotations

import base64
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any
from urllib.parse import quote, quote_plus

from .errors import ValidationError

REDACTED = "[REDACTED]"


@dataclass(frozen=True, slots=True)
class SecretReference:
    provider: str
    key: str

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", self.provider):
            raise ValidationError("secret provider reference is invalid")
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9._:-]{2,127}", self.key):
            raise ValidationError("secret key reference is invalid")


GENERIC_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+"),
    re.compile(
        r"(?i)([\"']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)[\"']?\s*[:=]\s*[\"']?)[^\s,;\"']+"
    ),
    re.compile(r"(?i)([?&](?:api[_-]?key|key|token|access_token)=)[^&#\s]+"),
    re.compile(r"\b(?:sk|pk|rk|api)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bnvapi-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bgh[oprsu]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?"
        r"-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
        re.DOTALL,
    ),
)


class SecretRedactor:
    def __init__(self, secrets: Mapping[str, str] | None = None) -> None:
        variants: set[str] = set()
        for value in (secrets or {}).values():
            if not value or len(value) < 4:
                continue
            variants.update({value, quote(value, safe=""), quote_plus(value)})
            variants.add(base64.b64encode(value.encode("utf-8")).decode("ascii"))
        self._variants = tuple(sorted(variants, key=len, reverse=True))

    def redact_text(self, value: str) -> str:
        result = value
        for secret in self._variants:
            result = result.replace(secret, REDACTED)
        for pattern in GENERIC_PATTERNS:
            if pattern.groups:
                result = pattern.sub(lambda match: f"{match.group(1)}{REDACTED}", result)
            else:
                result = pattern.sub(REDACTED, result)
        return result

    def redact(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact_text(value)
        if isinstance(value, bytes):
            return self.redact_text(value.decode("utf-8", errors="replace"))
        if is_dataclass(value) and not isinstance(value, type):
            return self.redact(asdict(value))
        if isinstance(value, Mapping):
            result: dict[Any, Any] = {}
            for key, item in value.items():
                lowered = str(key).lower()
                result[key] = (
                    REDACTED
                    if any(
                        marker in lowered
                        for marker in (
                            "password",
                            "secret",
                            "token",
                            "api_key",
                            "apikey",
                            "authorization",
                        )
                    )
                    else self.redact(item)
                )
            return result
        if isinstance(value, tuple):
            return tuple(self.redact(item) for item in value)
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        if isinstance(value, set):
            return {self.redact(item) for item in value}
        return value
