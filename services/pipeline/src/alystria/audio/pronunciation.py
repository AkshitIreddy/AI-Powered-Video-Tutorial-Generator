"""Pronunciation lexicon resolution and dependency invalidation.

Rules are resolved by scope (occurrence > project > global), then by longest
match.  The invalidation planner compares effective matches, so changing an
overridden global rule does not needlessly regenerate a scene.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from enum import StrEnum

from .models import SpeechRequest


class PronunciationScope(StrEnum):
    GLOBAL = "global"
    PROJECT = "project"
    OCCURRENCE = "occurrence"


_SCOPE_PRIORITY = {
    PronunciationScope.GLOBAL: 1,
    PronunciationScope.PROJECT: 2,
    PronunciationScope.OCCURRENCE: 3,
}


@dataclass(frozen=True, slots=True)
class PronunciationRule:
    rule_id: str
    revision: int
    scope: PronunciationScope
    grapheme: str
    locale: str
    spoken_alias: str | None = None
    ipa: str | None = None
    project_id: str | None = None
    occurrence_request_id: str | None = None
    occurrence_start: int | None = None
    occurrence_end: int | None = None
    case_sensitive: bool = False
    whole_word: bool = True
    active: bool = True

    def __post_init__(self) -> None:
        if not self.rule_id or self.revision < 1:
            raise ValueError("pronunciation rule requires an id and positive revision")
        if not self.grapheme or not self.locale:
            raise ValueError("pronunciation rule requires grapheme and locale")
        if not self.spoken_alias and not self.ipa:
            raise ValueError("pronunciation rule requires a spoken alias or IPA")
        if self.scope is PronunciationScope.GLOBAL:
            if self.project_id or self.occurrence_request_id:
                raise ValueError("global pronunciation rules cannot target a project or occurrence")
        elif self.scope is PronunciationScope.PROJECT:
            if not self.project_id or self.occurrence_request_id:
                raise ValueError("project pronunciation rules require only project_id")
        else:
            if not self.occurrence_request_id:
                raise ValueError("occurrence rule requires occurrence_request_id")
            if self.occurrence_start is None or self.occurrence_end is None:
                raise ValueError("occurrence rule requires exact text offsets")
            if self.occurrence_start < 0 or self.occurrence_end <= self.occurrence_start:
                raise ValueError("invalid occurrence rule offsets")


@dataclass(frozen=True, slots=True)
class ResolvedPronunciation:
    rule_id: str
    rule_revision: int
    scope: PronunciationScope
    start: int
    end: int
    grapheme: str
    spoken_alias: str | None
    ipa: str | None

    @property
    def fingerprint(self) -> str:
        payload = {
            "rule_id": self.rule_id,
            "revision": self.rule_revision,
            "scope": self.scope,
            "start": self.start,
            "end": self.end,
            "grapheme": self.grapheme,
            "spoken_alias": self.spoken_alias,
            "ipa": self.ipa,
        }
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


@dataclass(frozen=True, slots=True)
class PronunciationInvalidation:
    request_id: str
    before_fingerprint: str
    after_fingerprint: str
    stale_logical_keys: tuple[str, ...]


def resolve_pronunciations(
    request: SpeechRequest,
    rules: tuple[PronunciationRule, ...] | list[PronunciationRule],
    *,
    project_id: str | None,
) -> tuple[ResolvedPronunciation, ...]:
    """Return non-overlapping effective rules for a speech request."""

    candidates: list[ResolvedPronunciation] = []
    for rule in rules:
        if not _rule_applies(rule, request, project_id):
            continue
        for start, end in _find_matches(rule, request):
            candidates.append(
                ResolvedPronunciation(
                    rule_id=rule.rule_id,
                    rule_revision=rule.revision,
                    scope=rule.scope,
                    start=start,
                    end=end,
                    grapheme=request.text[start:end],
                    spoken_alias=rule.spoken_alias,
                    ipa=rule.ipa,
                )
            )

    # Claim spans in precedence order. This makes an occurrence override win
    # even if it is nested inside a longer global phrase.
    candidates.sort(
        key=lambda item: (
            -_SCOPE_PRIORITY[item.scope],
            -(item.end - item.start),
            item.start,
            item.rule_id,
        )
    )
    selected: list[ResolvedPronunciation] = []
    for candidate in candidates:
        if any(_overlaps(candidate, existing) for existing in selected):
            continue
        selected.append(candidate)
    return tuple(sorted(selected, key=lambda item: (item.start, item.end)))


def pronunciation_fingerprint(resolved: tuple[ResolvedPronunciation, ...]) -> str:
    serialized = "\n".join(item.fingerprint for item in resolved)
    return hashlib.sha256(serialized.encode()).hexdigest()


def plan_pronunciation_invalidation(
    requests: tuple[SpeechRequest, ...] | list[SpeechRequest],
    *,
    before_rules: tuple[PronunciationRule, ...] | list[PronunciationRule],
    after_rules: tuple[PronunciationRule, ...] | list[PronunciationRule],
    project_id: str | None,
) -> tuple[PronunciationInvalidation, ...]:
    """Invalidate only requests whose effective pronunciation changed."""

    impacts: list[PronunciationInvalidation] = []
    for request in requests:
        before = pronunciation_fingerprint(
            resolve_pronunciations(request, before_rules, project_id=project_id)
        )
        after = pronunciation_fingerprint(
            resolve_pronunciations(request, after_rules, project_id=project_id)
        )
        if before == after:
            continue
        prefix = f"speech:{request.request_id}"
        impacts.append(
            PronunciationInvalidation(
                request_id=request.request_id,
                before_fingerprint=before,
                after_fingerprint=after,
                stale_logical_keys=(
                    f"{prefix}:narration",
                    f"{prefix}:alignment",
                    f"{prefix}:captions",
                    f"{prefix}:presenter",
                    f"{prefix}:timing",
                    f"{prefix}:scene-render",
                    f"{prefix}:qa",
                    "composition:final",
                ),
            )
        )
    return tuple(impacts)


def _rule_applies(rule: PronunciationRule, request: SpeechRequest, project_id: str | None) -> bool:
    if not rule.active or not _locale_matches(rule.locale, request.locale):
        return False
    if rule.scope is PronunciationScope.PROJECT and rule.project_id != project_id:
        return False
    return not (
        rule.scope is PronunciationScope.OCCURRENCE
        and rule.occurrence_request_id != request.request_id
    )


def _locale_matches(rule_locale: str, request_locale: str) -> bool:
    rule = rule_locale.casefold()
    request = request_locale.casefold()
    return rule == request or ("-" not in rule and request.split("-", 1)[0] == rule)


def _find_matches(rule: PronunciationRule, request: SpeechRequest) -> tuple[tuple[int, int], ...]:
    if rule.scope is PronunciationScope.OCCURRENCE:
        assert rule.occurrence_start is not None and rule.occurrence_end is not None
        start, end = rule.occurrence_start, rule.occurrence_end
        if end > len(request.text):
            return ()
        candidate = request.text[start:end]
        if _equal(candidate, rule.grapheme, rule.case_sensitive):
            return ((start, end),)
        return ()

    flags = 0 if rule.case_sensitive else re.IGNORECASE
    escaped = re.escape(rule.grapheme)
    pattern = rf"(?<!\w){escaped}(?!\w)" if rule.whole_word else escaped
    return tuple(
        (match.start(), match.end()) for match in re.finditer(pattern, request.text, flags)
    )


def _equal(left: str, right: str, case_sensitive: bool) -> bool:
    return left == right if case_sensitive else left.casefold() == right.casefold()


def _overlaps(left: ResolvedPronunciation, right: ResolvedPronunciation) -> bool:
    return left.start < right.end and right.start < left.end
