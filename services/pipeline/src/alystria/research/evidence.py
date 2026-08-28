"""Evidence ledger, claim graph, contradictions, and grounding policies."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from enum import StrEnum
from hashlib import sha256

from alystria.sources import SourceDocument
from alystria.sources.models import stable_id


@dataclass(frozen=True, slots=True)
class EvidenceChunk:
    id: str
    source_id: str
    source_version_id: str
    ordinal: int
    text: str
    content_sha256: str
    locator: str
    start_char: int
    end_char: int
    metadata: Mapping[str, object] = field(default_factory=dict)


def chunk_source(
    document: SourceDocument,
    *,
    target_chars: int = 1_200,
    overlap_chars: int = 120,
) -> tuple[EvidenceChunk, ...]:
    if target_chars < 100:
        raise ValueError("target chunk size must be at least 100 characters")
    if overlap_chars < 0 or overlap_chars >= target_chars:
        raise ValueError("overlap must be non-negative and smaller than target")
    content = document.content
    chunks: list[EvidenceChunk] = []
    start = 0
    ordinal = 0
    while start < len(content):
        tentative_end = min(len(content), start + target_chars)
        end = tentative_end
        if tentative_end < len(content):
            candidates = [
                content.rfind("\n\n", start + target_chars // 2, tentative_end),
                content.rfind(". ", start + target_chars // 2, tentative_end),
                content.rfind("\n", start + target_chars // 2, tentative_end),
            ]
            boundary = max(candidates)
            if boundary > start:
                end = boundary + (2 if content[boundary : boundary + 2] in {"\n\n", ". "} else 1)
        raw_text = content[start:end]
        leading = len(raw_text) - len(raw_text.lstrip())
        trailing = len(raw_text.rstrip())
        text_start = start + leading
        text_end = start + trailing
        text = content[text_start:text_end]
        if text:
            digest = sha256(text.encode("utf-8")).hexdigest()
            chunks.append(
                EvidenceChunk(
                    id=stable_id("ev", document.version_id, str(ordinal), digest),
                    source_id=document.id,
                    source_version_id=document.version_id,
                    ordinal=ordinal,
                    text=text,
                    content_sha256=digest,
                    locator=f"{document.metadata.locator}#chars={text_start}-{text_end}",
                    start_char=text_start,
                    end_char=text_end,
                    metadata={
                        "title": document.metadata.title,
                        "media_type": document.metadata.media_type,
                    },
                )
            )
            ordinal += 1
        if end >= len(content):
            break
        next_start = max(start + 1, end - overlap_chars)
        while next_start < end and not content[next_start].isspace():
            next_start += 1
        start = next_start
    return tuple(chunks)


class ClaimStatus(StrEnum):
    UNASSESSED = "unassessed"
    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    CONTRADICTED = "contradicted"


@dataclass(frozen=True, slots=True)
class AtomicClaim:
    id: str
    statement: str
    externally_verifiable: bool = True
    importance: str = "normal"

    @classmethod
    def create(
        cls,
        statement: str,
        *,
        externally_verifiable: bool = True,
        importance: str = "normal",
    ) -> AtomicClaim:
        normalized = re.sub(r"\s+", " ", statement).strip()
        if not normalized:
            raise ValueError("claim statement must not be blank")
        if importance not in {"low", "normal", "high", "critical"}:
            raise ValueError("invalid claim importance")
        return cls(stable_id("claim", normalized), normalized, externally_verifiable, importance)


class SupportRelation(StrEnum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"


@dataclass(frozen=True, slots=True)
class ClaimSupport:
    claim_id: str
    evidence_chunk_id: str
    relation: SupportRelation
    confidence: float
    rationale: str = ""

    def __post_init__(self) -> None:
        if not 0 <= self.confidence <= 1:
            raise ValueError("support confidence must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class EvidenceMatch:
    """A deterministic relation to one claim-specific, exact source span."""

    evidence: EvidenceChunk
    relation: SupportRelation
    confidence: float
    rationale: str


_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "because",
        "by",
        "for",
        "from",
        "has",
        "have",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "their",
        "this",
        "to",
        "was",
        "were",
        "with",
    }
)
_NEGATIONS = frozenset(
    {"cannot", "contrary", "false", "incorrect", "never", "no", "not", "without", "wrong"}
)
_ASSERTION_WORDS = frozenset(
    {
        "are",
        "becomes",
        "equals",
        "gives",
        "has",
        "have",
        "is",
        "produces",
        "solves",
        "uses",
        "was",
    }
)
_TOKEN_RE = re.compile(r"[a-z][a-z0-9]*|\d+(?:\.\d+)?|[=+\-*/^()]", re.IGNORECASE)
_BLOCK_RE = re.compile(r"(?:\r?\n\s*){2,}")
_SENTENCE_RE = re.compile(r"(?<=[.!?])(?:[ \t]+|(?=\r?\n))")


def verify_claim_evidence(
    claim: AtomicClaim,
    chunks: Iterable[EvidenceChunk],
) -> EvidenceMatch | None:
    """Find the strongest substantive exact span for ``claim``.

    This deliberately small offline verifier is conservative. It accepts exact
    or near-exact lexical/structured entailment, requires all quantitative
    values in the claim to occur in the source span, and recognizes explicit
    negation or a conflicting asserted value as contradiction. It does not
    infer support merely because a source was selected by the caller.
    """

    best_support: tuple[float, EvidenceChunk, str] | None = None
    best_contradiction: tuple[float, EvidenceChunk, str] | None = None
    for chunk in chunks:
        for local_start, local_end in _candidate_spans(chunk.text):
            text = chunk.text[local_start:local_end].strip()
            if not text:
                continue
            leading = len(chunk.text[local_start:local_end]) - len(
                chunk.text[local_start:local_end].lstrip()
            )
            trailing = len(chunk.text[local_start:local_end].rstrip())
            exact_start = chunk.start_char + local_start + leading
            exact_end = chunk.start_char + local_start + trailing
            relation, confidence, rationale = _classify_span(claim.statement, text)
            if relation is None:
                continue
            digest = sha256(text.encode("utf-8")).hexdigest()
            exact = EvidenceChunk(
                id=stable_id(
                    "evspan",
                    chunk.source_version_id,
                    str(exact_start),
                    str(exact_end),
                    digest,
                ),
                source_id=chunk.source_id,
                source_version_id=chunk.source_version_id,
                ordinal=chunk.ordinal,
                text=text,
                content_sha256=digest,
                locator=_span_locator(chunk.locator, exact_start, exact_end),
                start_char=exact_start,
                end_char=exact_end,
                metadata={**chunk.metadata, "claim_specific": True},
            )
            candidate = (confidence, exact, rationale)
            if relation is SupportRelation.CONTRADICTS:
                if best_contradiction is None or candidate[0] > best_contradiction[0]:
                    best_contradiction = candidate
            elif best_support is None or candidate[0] > best_support[0]:
                best_support = candidate

    # A sufficiently strong contradiction always takes precedence over a
    # positive span so conflicting sources cannot silently certify a claim.
    if best_contradiction is not None and best_contradiction[0] >= 0.6:
        confidence, evidence, rationale = best_contradiction
        return EvidenceMatch(evidence, SupportRelation.CONTRADICTS, confidence, rationale)
    if best_support is not None:
        confidence, evidence, rationale = best_support
        return EvidenceMatch(evidence, SupportRelation.SUPPORTS, confidence, rationale)
    return None


def _candidate_spans(text: str) -> tuple[tuple[int, int], ...]:
    spans: set[tuple[int, int]] = set()
    paragraphs = _split_spans(text, _BLOCK_RE)
    sentences = _split_spans(text, _SENTENCE_RE)
    for units, maximum_window in ((paragraphs, 3), (sentences, 3)):
        for start_index in range(len(units)):
            for size in range(1, maximum_window + 1):
                end_index = start_index + size - 1
                if end_index >= len(units):
                    break
                spans.add((units[start_index][0], units[end_index][1]))
    if not spans and text.strip():
        spans.add((0, len(text)))
    return tuple(sorted(spans, key=lambda item: (item[1] - item[0], item[0])))


def _split_spans(text: str, separator: re.Pattern[str]) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = 0
    for match in separator.finditer(text):
        if text[start : match.start()].strip():
            spans.append((start, match.start()))
        start = match.end()
    if text[start:].strip():
        spans.append((start, len(text)))
    return spans


def _span_locator(locator: str, start: int, end: int) -> str:
    base = locator.split("#chars=", 1)[0]
    return f"{base}#chars={start}-{end}"


def _normalized(text: str) -> str:
    value = unicodedata.normalize("NFKC", text).lower()
    value = re.sub(r"(?<=\d)[,_](?=\d)", "", value)
    value = value.replace("\N{MULTIPLICATION SIGN}", "*").replace("\N{DIVISION SIGN}", "/")
    value = (
        value.replace("\N{MINUS SIGN}", "-").replace("\N{EN DASH}", "-").replace("\N{EM DASH}", "-")
    )
    value = re.sub(r"\b(?:equals?|equal to)\b", "=", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN_RE.findall(_normalized(text)))


def _substantive(tokens: Iterable[str]) -> tuple[str, ...]:
    return tuple(
        token
        for token in tokens
        if token not in _STOP_WORDS
        and token not in _NEGATIONS
        and (not token.isalpha() or len(token) >= 2)
    )


def _classify_span(statement: str, evidence: str) -> tuple[SupportRelation | None, float, str]:
    claim_normalized = _normalized(statement)
    evidence_normalized = _normalized(evidence)
    claim_tokens = _tokens(statement)
    evidence_tokens = _tokens(evidence)
    claim_substantive = _substantive(claim_tokens)
    evidence_substantive = _substantive(evidence_tokens)
    if not claim_substantive:
        return None, 0.0, "The claim has no substantive lexical or structured atoms."

    claim_set = set(claim_substantive)
    evidence_set = set(evidence_substantive)
    matched = claim_set & evidence_set
    lexical_coverage = len(matched) / len(claim_set)
    word_anchors = {token for token in claim_set if token.isalpha() and len(token) >= 3}
    matched_word_anchors = word_anchors & evidence_set
    numbers = {token for token in claim_set if token[0].isdigit()}
    evidence_numbers = {token for token in evidence_set if token[0].isdigit()}
    numbers_complete = numbers <= evidence_numbers
    structured = {token for token in claim_set if token in "=+-*/^()" or len(token) <= 2}
    structured_coverage = (
        len(structured & evidence_set) / len(structured) if structured else lexical_coverage
    )
    sequence_similarity = SequenceMatcher(
        None,
        " ".join(claim_substantive),
        " ".join(evidence_substantive),
        autojunk=False,
    ).ratio()
    confidence = min(
        0.99,
        0.68 * lexical_coverage + 0.17 * structured_coverage + 0.15 * sequence_similarity,
    )
    if claim_normalized in evidence_normalized:
        confidence = max(confidence, 0.98)

    claim_negated = _negates_claim(claim_tokens, claim_set)
    evidence_negated = _negates_claim(evidence_tokens, claim_set)
    same_subject = bool(matched_word_anchors) and (
        not word_anchors or len(matched_word_anchors) / len(word_anchors) >= 0.6
    )
    assertion = bool(set(evidence_tokens) & _ASSERTION_WORDS) or "=" in evidence_tokens
    value_conflict = bool(
        numbers
        and evidence_numbers
        and not numbers_complete
        and (same_subject or _equation_conflict(claim_tokens, evidence_tokens))
    )
    polarity_conflict = claim_negated != evidence_negated
    contradiction_coverage = lexical_coverage >= 0.7 or (same_subject and len(matched) >= 2)
    if contradiction_coverage and assertion and (polarity_conflict or value_conflict):
        kind = "opposite polarity" if polarity_conflict else "conflicting asserted value"
        return (
            SupportRelation.CONTRADICTS,
            max(confidence, 0.8),
            f"Exact span has {kind} with substantive claim overlap {lexical_coverage:.3f}.",
        )

    # Numbers must match exactly. Purely verbal claims require at least two
    # substantive anchors, while structured mathematical claims may use one
    # word anchor plus a dense expression match.
    enough_anchors = len(matched_word_anchors) >= min(2, len(word_anchors))
    structured_entailment = (
        bool(structured) and structured_coverage >= 0.8 and bool(matched_word_anchors)
    )
    if (
        not polarity_conflict
        and numbers_complete
        and lexical_coverage >= 0.72
        and (enough_anchors or structured_entailment)
    ):
        return (
            SupportRelation.SUPPORTS,
            confidence,
            "Exact span substantively matches the claim "
            f"(lexical={lexical_coverage:.3f}, structured={structured_coverage:.3f}).",
        )
    return None, confidence, "The span does not substantively establish the claim."


def _negates_claim(tokens: tuple[str, ...], claim_atoms: set[str]) -> bool:
    for index, token in enumerate(tokens):
        if token not in _NEGATIONS:
            continue
        local = set(tokens[max(0, index - 4) : index + 5]) & claim_atoms
        if local:
            return True
    return False


def _equation_conflict(claim_tokens: tuple[str, ...], evidence_tokens: tuple[str, ...]) -> bool:
    if "=" not in claim_tokens or "=" not in evidence_tokens:
        return False
    claim_equal = claim_tokens.index("=")
    claim_left = tuple(token for token in claim_tokens[:claim_equal] if token not in _STOP_WORDS)
    claim_right = tuple(
        token for token in claim_tokens[claim_equal + 1 :] if token not in _STOP_WORDS
    )
    if not claim_left or not claim_right:
        return False
    for evidence_equal, token in enumerate(evidence_tokens):
        if token != "=" or evidence_equal < len(claim_left):
            continue
        evidence_left = tuple(
            item
            for item in evidence_tokens[evidence_equal - len(claim_left) : evidence_equal]
            if item not in _STOP_WORDS
        )
        evidence_right = tuple(
            item
            for item in evidence_tokens[evidence_equal + 1 : evidence_equal + 1 + len(claim_right)]
            if item not in _STOP_WORDS
        )
        if evidence_left == claim_left and evidence_right and evidence_right != claim_right:
            return True
    return False


@dataclass(frozen=True, slots=True)
class AssessedClaim:
    claim: AtomicClaim
    status: ClaimStatus
    supports: tuple[ClaimSupport, ...]
    contradictions: tuple[ClaimSupport, ...]


class EvidenceLedger:
    def __init__(self) -> None:
        self._chunks: dict[str, EvidenceChunk] = {}
        self._claims: dict[str, AtomicClaim] = {}
        self._links: list[ClaimSupport] = []

    @property
    def chunks(self) -> tuple[EvidenceChunk, ...]:
        return tuple(self._chunks.values())

    @property
    def claims(self) -> tuple[AtomicClaim, ...]:
        return tuple(self._claims.values())

    def add_chunks(self, chunks: Iterable[EvidenceChunk]) -> None:
        for chunk in chunks:
            existing = self._chunks.get(chunk.id)
            if existing and existing != chunk:
                raise ValueError(f"evidence chunk ID collision: {chunk.id}")
            self._chunks[chunk.id] = chunk

    def add_claim(self, claim: AtomicClaim) -> None:
        existing = self._claims.get(claim.id)
        if existing and existing != claim:
            raise ValueError(f"claim ID collision: {claim.id}")
        self._claims[claim.id] = claim

    def link(self, support: ClaimSupport) -> None:
        if support.claim_id not in self._claims:
            raise KeyError(f"unknown claim: {support.claim_id}")
        if support.evidence_chunk_id not in self._chunks:
            raise KeyError(f"unknown evidence chunk: {support.evidence_chunk_id}")
        self._links.append(support)

    def assess(self, claim_id: str, *, minimum_confidence: float = 0.6) -> AssessedClaim:
        claim = self._claims[claim_id]
        supports = tuple(
            link
            for link in self._links
            if link.claim_id == claim_id
            and link.relation == SupportRelation.SUPPORTS
            and link.confidence >= minimum_confidence
        )
        contradictions = tuple(
            link
            for link in self._links
            if link.claim_id == claim_id
            and link.relation == SupportRelation.CONTRADICTS
            and link.confidence >= minimum_confidence
        )
        if contradictions:
            status = ClaimStatus.CONTRADICTED
        elif supports:
            status = ClaimStatus.SUPPORTED
        elif claim.externally_verifiable:
            status = ClaimStatus.UNSUPPORTED
        else:
            status = ClaimStatus.UNASSESSED
        return AssessedClaim(claim, status, supports, contradictions)


class GroundingMode(StrEnum):
    CREATIVE = "creative"
    GROUNDED = "grounded"
    STRICT = "strict"


@dataclass(frozen=True, slots=True)
class PolicyFinding:
    claim_id: str
    severity: str
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class PolicyResult:
    mode: GroundingMode
    accepted: bool
    findings: tuple[PolicyFinding, ...]


class ResearchPolicy:
    def __init__(self, mode: GroundingMode) -> None:
        self.mode = mode

    def evaluate(self, ledger: EvidenceLedger) -> PolicyResult:
        findings: list[PolicyFinding] = []
        minimum = 0.75 if self.mode == GroundingMode.STRICT else 0.6
        for claim in ledger.claims:
            assessed = ledger.assess(claim.id, minimum_confidence=minimum)
            if assessed.status == ClaimStatus.CONTRADICTED:
                findings.append(
                    PolicyFinding(
                        claim.id,
                        "error",
                        "claim.contradicted",
                        "Reliable evidence contradicts this claim.",
                    )
                )
            elif assessed.status == ClaimStatus.UNSUPPORTED:
                severity = "warning" if self.mode == GroundingMode.CREATIVE else "error"
                findings.append(
                    PolicyFinding(
                        claim.id,
                        severity,
                        "claim.unsupported",
                        "No sufficiently strong evidence supports this claim.",
                    )
                )
        accepted = not any(item.severity == "error" for item in findings)
        return PolicyResult(self.mode, accepted, tuple(findings))
