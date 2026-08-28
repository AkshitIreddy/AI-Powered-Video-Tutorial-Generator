"""Normalized academic discovery adapters.

Adapters depend on an injected bounded transport.  This makes network policy a
single concern and makes all contract tests deterministic and offline.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import quote, urlencode
from xml.etree import ElementTree

from alystria.sources import SafeHttpTransport, SourceLoadError
from alystria.sources.models import stable_id


@dataclass(frozen=True, slots=True)
class AcademicWork:
    provider: str
    provider_id: str
    title: str
    url: str
    authors: tuple[str, ...] = ()
    published: str | None = None
    abstract: str | None = None
    identifiers: Mapping[str, str] = field(default_factory=dict)
    open_access_url: str | None = None
    citation_count: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


class AcademicAdapter(Protocol):
    name: str

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]: ...


class ResearchHttpClient:
    def __init__(
        self,
        transport: SafeHttpTransport,
        *,
        user_agent: str = "Alystria-Studio/2",
    ) -> None:
        self.transport = transport
        self.user_agent = user_agent

    def json(self, url: str) -> Any:
        response = self.transport.get(
            url,
            headers={"Accept": "application/json", "User-Agent": self.user_agent},
        )
        try:
            return json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SourceLoadError("academic provider returned invalid JSON") from exc

    def text(self, url: str, *, accept: str = "application/xml") -> str:
        response = self.transport.get(
            url,
            headers={"Accept": accept, "User-Agent": self.user_agent},
        )
        try:
            return response.body.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SourceLoadError("academic provider returned invalid UTF-8") from exc


def _limit(value: int) -> int:
    if not 1 <= value <= 100:
        raise ValueError("academic search limit must be between 1 and 100")
    return value


def _text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def _year_from_parts(parts: Any) -> str | None:
    try:
        values = parts[0]
        return "-".join(str(value).zfill(2) for value in values)
    except (IndexError, TypeError):
        return None


class OpenAlexAdapter:
    name = "openalex"
    endpoint = "https://api.openalex.org/works"

    def __init__(self, client: ResearchHttpClient) -> None:
        self.client = client

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        url = f"{self.endpoint}?{urlencode({'search': query, 'per-page': _limit(limit)})}"
        payload = self.client.json(url)
        works = []
        for item in payload.get("results", []):
            authors = tuple(
                entry.get("author", {}).get("display_name", "").strip()
                for entry in item.get("authorships", [])
                if entry.get("author", {}).get("display_name")
            )
            ids = {key: str(value) for key, value in item.get("ids", {}).items() if value}
            primary = item.get("primary_location") or {}
            oa = item.get("open_access") or {}
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=str(item.get("id", "")),
                    title=str(item.get("display_name") or item.get("title") or "Untitled"),
                    url=str(item.get("id") or primary.get("landing_page_url") or ""),
                    authors=authors,
                    published=_text(item.get("publication_date") or item.get("publication_year")),
                    abstract=None,
                    identifiers=ids,
                    open_access_url=_text(primary.get("pdf_url") or oa.get("oa_url")),
                    citation_count=item.get("cited_by_count"),
                    metadata={
                        "type": item.get("type"),
                        "is_retracted": item.get("is_retracted", False),
                    },
                )
            )
        return works


class CrossrefAdapter:
    name = "crossref"
    endpoint = "https://api.crossref.org/works"

    def __init__(self, client: ResearchHttpClient, *, mailto: str | None = None) -> None:
        self.client = client
        self.mailto = mailto

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        params: dict[str, object] = {"query.bibliographic": query, "rows": _limit(limit)}
        if self.mailto:
            params["mailto"] = self.mailto
        payload = self.client.json(f"{self.endpoint}?{urlencode(params)}")
        works = []
        for item in payload.get("message", {}).get("items", []):
            title_values = item.get("title") or ["Untitled"]
            authors = tuple(
                " ".join(
                    part
                    for part in (entry.get("given", ""), entry.get("family", ""))
                    if part
                ).strip()
                for entry in item.get("author", [])
            )
            doi = str(item.get("DOI", ""))
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=doi,
                    title=str(title_values[0]),
                    url=str(item.get("URL") or (f"https://doi.org/{doi}" if doi else "")),
                    authors=authors,
                    published=_year_from_parts((item.get("published") or {}).get("date-parts")),
                    abstract=_text(item.get("abstract")),
                    identifiers={"doi": doi} if doi else {},
                    citation_count=item.get("is-referenced-by-count"),
                    metadata={"type": item.get("type"), "publisher": item.get("publisher")},
                )
            )
        return works


class DataCiteAdapter:
    name = "datacite"
    endpoint = "https://api.datacite.org/dois"

    def __init__(self, client: ResearchHttpClient) -> None:
        self.client = client

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        params = {"query": query, "page[size]": _limit(limit)}
        payload = self.client.json(f"{self.endpoint}?{urlencode(params)}")
        works = []
        for item in payload.get("data", []):
            attrs = item.get("attributes", {})
            titles = attrs.get("titles") or []
            creators = attrs.get("creators") or []
            descriptions = attrs.get("descriptions") or []
            doi = str(attrs.get("doi") or item.get("id") or "")
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=str(item.get("id") or doi),
                    title=str((titles[0] if titles else {}).get("title") or "Untitled"),
                    url=str(attrs.get("url") or (f"https://doi.org/{doi}" if doi else "")),
                    authors=tuple(
                        str(author.get("name", ""))
                        for author in creators
                        if author.get("name")
                    ),
                    published=_text(attrs.get("published") or attrs.get("publicationYear")),
                    abstract=_text((descriptions[0] if descriptions else {}).get("description")),
                    identifiers={"doi": doi} if doi else {},
                    metadata={"types": attrs.get("types"), "publisher": attrs.get("publisher")},
                )
            )
        return works


class OpenCitationsAdapter:
    """Resolve DOI citation relationships through the OpenCitations v2 API."""

    name = "opencitations"
    endpoint = "https://api.opencitations.net/index/v2/citations"

    def __init__(self, client: ResearchHttpClient) -> None:
        self.client = client

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        doi = query.removeprefix("https://doi.org/").removeprefix("doi:").strip()
        payload = self.client.json(f"{self.endpoint}/doi:{quote(doi, safe='')}")
        works = []
        for item in payload[: _limit(limit)]:
            citing = str(item.get("citing") or "")
            cited = str(item.get("cited") or doi)
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=citing,
                    title=f"Citation of {cited}",
                    url=f"https://doi.org/{citing.removeprefix('doi:')}" if citing else "",
                    published=_text(item.get("creation")),
                    identifiers={"doi": citing.removeprefix("doi:")} if citing else {},
                    metadata={"cited": cited, "timespan": item.get("timespan")},
                )
            )
        return works


class EuropePmcAdapter:
    name = "europe_pmc"
    endpoint = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

    def __init__(self, client: ResearchHttpClient) -> None:
        self.client = client

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        params = {"query": query, "pageSize": _limit(limit), "format": "json", "resultType": "core"}
        payload = self.client.json(f"{self.endpoint}?{urlencode(params)}")
        works = []
        for item in payload.get("resultList", {}).get("result", []):
            author_text = str(item.get("authorString") or "")
            authors = tuple(
                part.strip()
                for part in author_text.rstrip(".").split(",")
                if part.strip()
            )
            work_id = str(item.get("pmcid") or item.get("pmid") or item.get("id") or "")
            doi = _text(item.get("doi"))
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=work_id,
                    title=str(item.get("title") or "Untitled"),
                    url=f"https://europepmc.org/article/{item.get('source', 'MED')}/{work_id}",
                    authors=authors,
                    published=_text(item.get("firstPublicationDate") or item.get("pubYear")),
                    abstract=_text(item.get("abstractText")),
                    identifiers={
                        key: value
                        for key, value in {
                            "doi": doi,
                            "pmid": _text(item.get("pmid")),
                            "pmcid": _text(item.get("pmcid")),
                        }.items()
                        if value
                    },
                    open_access_url=(
                        f"https://europepmc.org/articles/{item['pmcid']}"
                        if item.get("pmcid")
                        else None
                    ),
                    citation_count=item.get("citedByCount"),
                    metadata={"is_open_access": item.get("isOpenAccess") == "Y"},
                )
            )
        return works


class ArxivAdapter:
    name = "arxiv"
    endpoint = "https://export.arxiv.org/api/query"
    atom = "{http://www.w3.org/2005/Atom}"

    def __init__(self, client: ResearchHttpClient) -> None:
        self.client = client

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        params = {"search_query": f"all:{query}", "start": 0, "max_results": _limit(limit)}
        raw = self.client.text(
            f"{self.endpoint}?{urlencode(params)}",
            accept="application/atom+xml",
        )
        if "<!DOCTYPE" in raw.upper() or "<!ENTITY" in raw.upper():
            raise SourceLoadError("arXiv response contains forbidden XML entities")
        try:
            root = ElementTree.fromstring(raw)
        except ElementTree.ParseError as exc:
            raise SourceLoadError("arXiv returned invalid Atom XML") from exc
        works = []
        for entry in root.findall(f"{self.atom}entry"):
            identifier = (entry.findtext(f"{self.atom}id") or "").strip()
            pdf_url = next(
                (
                    link.get("href")
                    for link in entry.findall(f"{self.atom}link")
                    if link.get("title") == "pdf"
                ),
                None,
            )
            works.append(
                AcademicWork(
                    provider=self.name,
                    provider_id=identifier.rsplit("/", 1)[-1],
                    title=" ".join((entry.findtext(f"{self.atom}title") or "Untitled").split()),
                    url=identifier,
                    authors=tuple(
                        (author.findtext(f"{self.atom}name") or "").strip()
                        for author in entry.findall(f"{self.atom}author")
                    ),
                    published=_text(entry.findtext(f"{self.atom}published")),
                    abstract=(
                        " ".join((entry.findtext(f"{self.atom}summary") or "").split())
                        or None
                    ),
                    identifiers={"arxiv": identifier.rsplit("/", 1)[-1]},
                    open_access_url=pdf_url,
                    metadata={"updated": _text(entry.findtext(f"{self.atom}updated"))},
                )
            )
        return works


class MockAcademicAdapter:
    """Deterministic offline adapter for fixtures and developer mode."""

    name = "mock"

    def __init__(self, works: Sequence[AcademicWork] = ()) -> None:
        self.works = tuple(works)

    def search(self, query: str, *, limit: int = 10) -> Sequence[AcademicWork]:
        needle = query.casefold().strip()
        matches = [
            work for work in self.works
            if needle in work.title.casefold() or needle in (work.abstract or "").casefold()
        ]
        return matches[: _limit(limit)]


@dataclass(frozen=True, slots=True)
class ResearchQuestion:
    id: str
    text: str
    rationale: str = ""

    @classmethod
    def create(cls, text: str, *, rationale: str = "") -> ResearchQuestion:
        normalized = " ".join(text.split())
        if not normalized:
            raise ValueError("research question must not be blank")
        return cls(stable_id("rq", normalized), normalized, rationale.strip())


@dataclass(frozen=True, slots=True)
class ResearchHit:
    question_id: str
    work: AcademicWork
    score: float
    providers: tuple[str, ...]


class ResearchCoordinator:
    """Query adapters and merge duplicate records using reciprocal-rank fusion."""

    def __init__(self, adapters: Sequence[AcademicAdapter], *, rrf_k: int = 60) -> None:
        if not adapters:
            raise ValueError("at least one academic adapter is required")
        if rrf_k <= 0:
            raise ValueError("RRF constant must be positive")
        self.adapters = tuple(adapters)
        self.rrf_k = rrf_k

    @staticmethod
    def _identity(work: AcademicWork) -> str:
        doi = work.identifiers.get("doi")
        if doi:
            return f"doi:{doi.removeprefix('https://doi.org/').casefold()}"
        if work.url:
            return f"url:{work.url.rstrip('/').casefold()}"
        return f"title:{' '.join(work.title.casefold().split())}"

    def research(
        self,
        question: ResearchQuestion,
        *,
        per_provider: int = 10,
    ) -> tuple[ResearchHit, ...]:
        scores: dict[str, float] = {}
        works: dict[str, AcademicWork] = {}
        providers: dict[str, set[str]] = {}
        for adapter in self.adapters:
            for rank, work in enumerate(adapter.search(question.text, limit=per_provider), 1):
                identity = self._identity(work)
                scores[identity] = scores.get(identity, 0.0) + 1.0 / (self.rrf_k + rank)
                works.setdefault(identity, work)
                providers.setdefault(identity, set()).add(adapter.name)
        return tuple(
            ResearchHit(question.id, works[identity], score, tuple(sorted(providers[identity])))
            for identity, score in sorted(
                scores.items(),
                key=lambda item: (-item[1], works[item[0]].title.casefold(), item[0]),
            )
        )
